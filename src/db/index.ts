import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { WORKSCRIBE_DIR, DB_PATH } from '../utils/paths'
import type { EventRow, SessionRow } from './types'
import { MIGRATIONS } from './migrations'
export type { EventRow, SessionRow } from './types'

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db

  // Ensure ~/.workscribe/ exists
  if (!fs.existsSync(WORKSCRIBE_DIR)) {
    try {
      fs.mkdirSync(WORKSCRIBE_DIR, { recursive: true })
    } catch (error) {
      // Rethrown as a clean, actionable message — callers reaching this
      // (explicit commands, or _capture/_hook's own try/catch) otherwise
      // only see a raw native stack trace with the real cause buried in it.
      throw new Error(`Could not create data directory ${WORKSCRIBE_DIR}: ${(error as Error).message}`)
    }
  }

  // Don't assign to _db until after migrations succeed — if applyMigrations
  // throws, _db stays null so the next call retries cleanly instead of
  // returning a partially-initialised singleton.
  const db = new DatabaseSync(DB_PATH)
  try {
    fs.chmodSync(DB_PATH, 0o600)
  } catch {
    /* ignore if already correct */
  }
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db)
  _db = db
  return _db
}

function applyMigrations(db: DatabaseSync): void {
  // Create the migration tracking table if this is the first run
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `)

  // Bootstrap: if the events table already exists but schema_migrations is
  // empty, this is an existing install that predates the migration system.
  // Seed version 1 as applied so we don't re-run the initial schema.
  const hasEvents = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").get()
  const hasVersion1 = db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get()

  if (hasEvents && !hasVersion1) {
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES ($version, datetime('now'))").run({
      version: 1,
    })
  }

  // Collect already-applied versions
  const applied = new Set(
    (db.prepare('SELECT version FROM schema_migrations').all() as { version: number }[]).map((row) => row.version)
  )

  // Apply each pending migration in order, wrapped in a transaction so a
  // partial failure leaves the DB cleanly at the previous version.
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue

    db.exec('BEGIN')
    try {
      db.exec(migration.sql)
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES ($version, datetime('now'))").run({
        version: migration.version,
      })
      db.exec('COMMIT')
    } catch (err) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* already rolled back or connection lost */
      }
      throw new Error(`Migration ${migration.version} (${migration.description}) failed: ${(err as Error).message}`)
    }
  }
}

// ─── Typed query helpers ──────────────────────────────────────────────────────

export function insertEvent(params: {
  captured_at: string
  command: string
  cwd: string
  exit_code: number | null
  duration_ms: number | null
  repo_name: string | null
  branch: string | null
  category: string
  metadata: string | null
  source: string | null
  file_path: string | null
}): void {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO events (captured_at, command, cwd, exit_code, duration_ms, repo_name, branch, category, metadata, source, file_path)
    VALUES ($captured_at, $command, $cwd, $exit_code, $duration_ms, $repo_name, $branch, $category, $metadata, $source, $file_path)
  `)
  stmt.run(params)
}

export function getRecentSessionsByRepo(repoName: string, limit: number): SessionRow[] {
  const db = getDb()
  return db
    .prepare('SELECT * FROM sessions WHERE repo_name = $repo_name ORDER BY started_at DESC LIMIT $limit')
    .all({ repo_name: repoName, limit }) as unknown as SessionRow[]
}

export function getLastSessionTouchingFile(filePath: string): SessionRow | undefined {
  const db = getDb()
  return db
    .prepare(
      `SELECT s.* FROM sessions s
       INNER JOIN session_events se ON se.session_id = s.id
       INNER JOIN events e ON e.id = se.event_id
       WHERE e.file_path = $file_path
       ORDER BY s.started_at DESC
       LIMIT 1`
    )
    .get({ file_path: filePath }) as SessionRow | undefined
}

export function getSessionBranch(sessionId: number): string | null {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT e.branch FROM events e
       INNER JOIN session_events se ON se.event_id = e.id
       WHERE se.session_id = $session_id AND e.branch IS NOT NULL
       ORDER BY e.captured_at DESC
       LIMIT 1`
    )
    .get({ session_id: sessionId }) as { branch: string } | undefined
  return row?.branch ?? null
}

export function getLastEventForFile(filePath: string, cwd: string): EventRow | undefined {
  const db = getDb()
  return db
    .prepare('SELECT * FROM events WHERE file_path = $file_path AND cwd = $cwd ORDER BY id DESC LIMIT 1')
    .get({ file_path: filePath, cwd }) as EventRow | undefined
}

export function getLastEvent(): EventRow | undefined {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 1')
  return stmt.get() as EventRow | undefined
}

export function getEventsForDate(date: string): EventRow[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT * FROM events
    WHERE date(captured_at, 'localtime') = $date
    ORDER BY captured_at ASC
  `)
  return stmt.all({ date }) as unknown as EventRow[]
}

export function getRecentEvents(limit = 20): EventRow[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM events ORDER BY captured_at DESC LIMIT $limit')
  return stmt.all({ limit }) as unknown as EventRow[]
}

export function getEventCount(): number {
  const db = getDb()
  const stmt = db.prepare('SELECT COUNT(*) as count FROM events')
  const row = stmt.get() as { count: number }
  return row.count
}

export function insertSession(params: {
  date: string
  started_at: string
  ended_at: string
  repo_name: string | null
  event_count: number
  summary: string | null
}): number {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO sessions (date, started_at, ended_at, repo_name, event_count, summary)
    VALUES ($date, $started_at, $ended_at, $repo_name, $event_count, $summary)
  `)
  const result = stmt.run(params)
  return Number(result.lastInsertRowid)
}

export function insertSessionEvent(sessionId: number, eventId: number): void {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO session_events (session_id, event_id) VALUES ($session_id, $event_id)
  `)
  stmt.run({ session_id: sessionId, event_id: eventId })
}

export function getEventsBySessionId(sessionId: number): EventRow[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT e.* FROM events e
    INNER JOIN session_events se ON se.event_id = e.id
    WHERE se.session_id = $session_id
    ORDER BY e.captured_at ASC
  `)
  return stmt.all({ session_id: sessionId }) as unknown as EventRow[]
}

export function getSessionsForDate(date: string): SessionRow[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM sessions WHERE date = $date ORDER BY started_at ASC')
  return stmt.all({ date }) as unknown as SessionRow[]
}

export function updateSessionSummary(sessionId: number, summary: string): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE sessions SET summary = $summary WHERE id = $id')
  stmt.run({ summary, id: sessionId })
}

export function getLastEventIds(n: number): number[] {
  const db = getDb()
  const rows = db.prepare('SELECT id FROM events ORDER BY id DESC LIMIT $n').all({ n }) as { id: number }[]
  return rows.map((row) => row.id)
}

export function getEventsByIds(ids: number[]): EventRow[] {
  if (ids.length === 0) return []
  const db = getDb()
  const placeholders = ids.map(() => '?').join(', ')
  return db
    .prepare(`SELECT * FROM events WHERE id IN (${placeholders}) ORDER BY id DESC`)
    .all(...ids) as unknown as EventRow[]
}

export function deleteEventsByIds(ids: number[]): void {
  if (ids.length === 0) return
  const db = getDb()
  const placeholders = ids.map(() => '?').join(', ')

  const affectedDates = db
    .prepare(`SELECT DISTINCT date(captured_at, 'localtime') as date FROM events WHERE id IN (${placeholders})`)
    .all(...ids) as { date: string }[]

  db.prepare(`DELETE FROM events WHERE id IN (${placeholders})`).run(...ids)

  for (const { date } of affectedDates) {
    clearSessionsForDate(date)
  }
}

export function deleteEventsForDate(date: string): number {
  const db = getDb()
  // Clear sessions (and session_events) before deleting events — FK constraint order
  clearSessionsForDate(date)
  const result = db.prepare(`DELETE FROM events WHERE date(captured_at, 'localtime') = $date`).run({ date }) as {
    changes: number
  }
  return result.changes
}

export function getOtherEventToolCounts(days: number): { tool: string; count: number }[] {
  const db = getDb()
  return db
    .prepare(
      `SELECT json_extract(metadata, '$.tool') as tool, COUNT(*) as count
       FROM events
       WHERE category = 'other'
         AND captured_at >= datetime('now', $offset)
         AND json_extract(metadata, '$.tool') IS NOT NULL
       GROUP BY tool
       ORDER BY count DESC`
    )
    .all({ offset: `-${days} days` }) as { tool: string; count: number }[]
}

export function getRecentOtherRate(days: number): { total: number; otherCount: number } {
  const db = getDb()
  const row = db
    .prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN category = 'other' THEN 1 ELSE 0 END) as otherCount
       FROM events
       WHERE captured_at >= datetime('now', $offset)`
    )
    .get({ offset: `-${days} days` }) as { total: number; otherCount: number }
  return row
}

export function clearSessionsForDate(date: string): void {
  const db = getDb()
  // Remove session_events first due to FK constraint
  db.prepare(
    `
    DELETE FROM session_events WHERE session_id IN (
      SELECT id FROM sessions WHERE date = $date
    )
  `
  ).run({ date })
  db.prepare('DELETE FROM sessions WHERE date = $date').run({ date })
}
