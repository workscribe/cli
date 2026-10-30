import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { WORKSCRIBE_DIR, DB_PATH } from '../utils/paths'
import type { EventRow, SessionRow, SessionSummaryRow } from './types'
import { MIGRATIONS } from './migrations'
import { applyMigrations } from './migrate'
import { findRecentSessionsForRepo, type RepoLookup } from './session-lookup'
import { BUSY_TIMEOUT_MS, withImmediateTransaction, type TransactionOptions } from './transaction'
import type { StoredEngine } from '../ai/engine'
import { insertEventRecord, type NewEvent } from './event-writer'
import { saveSummaryToBothStores } from './summary-store'
import type { SummaryAnchor } from '../summary/anchors'
export type { EventRow, SessionRow, SessionSummaryRow } from './types'

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
  // Parallel captures (an agent running several commands at once) wait for the write lock instead of failing
  db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  applyMigrations(db, MIGRATIONS)
  _db = db
  return _db
}

// ─── Typed query helpers ──────────────────────────────────────────────────────

export function insertEvent(event: NewEvent): void {
  insertEventRecord(getDb(), event)
}

export function getRecentSessionsForRepo(lookup: RepoLookup, limit: number): SessionRow[] {
  return findRecentSessionsForRepo(getDb(), lookup, limit)
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

export function getLastEventForCwd(cwd: string): EventRow | undefined {
  const db = getDb()
  return db.prepare('SELECT * FROM events WHERE cwd = $cwd ORDER BY id DESC LIMIT 1').get({ cwd }) as
    | EventRow
    | undefined
}

export function getEventsForDate(date: string): EventRow[] {
  const db = getDb()
  const stmt = db.prepare(`
    SELECT * FROM events
    WHERE date(captured_at, 'localtime') = $date
    ORDER BY captured_at ASC, id ASC
  `)
  return stmt.all({ date }) as unknown as EventRow[]
}

/** Events captured in [start, end) — ISO bounds, so the `captured_at` index is used (unlike a `localtime` match). */
export function countEventsBetween(start: string, end: string): number {
  const row = getDb()
    .prepare('SELECT COUNT(*) AS count FROM events WHERE captured_at >= $start AND captured_at < $end')
    .get({ start, end }) as { count: number }
  return row.count
}

/** How many events the day's grouped sessions hold — equal to the day's event count when the day is up to date. */
export function sumSessionEventCounts(date: string): number {
  const row = getDb()
    .prepare('SELECT COALESCE(SUM(event_count), 0) AS total FROM sessions WHERE date = $date')
    .get({ date }) as { total: number }
  return row.total
}

/** When this file was last saved in an editor (its newest `code_edit` event), or null if never. */
export function getLatestFileSaveAt(filePath: string): string | null {
  const row = getDb()
    .prepare(
      `SELECT captured_at FROM events
       WHERE file_path = $file_path AND category = 'code_edit'
       ORDER BY captured_at DESC
       LIMIT 1`
    )
    .get({ file_path: filePath }) as { captured_at: string } | undefined
  return row?.captured_at ?? null
}

/** Runs `work` holding the database's write lock — see `withImmediateTransaction`. */
export function runInImmediateTransaction<T>(work: () => T, options?: TransactionOptions): T {
  return withImmediateTransaction(getDb(), work, options)
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
    ORDER BY e.captured_at ASC, e.id ASC
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

export function getSessionSummaries(sessionKey: string): SessionSummaryRow[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM session_summaries WHERE session_key = $session_key')
  return stmt.all({ session_key: sessionKey }) as unknown as SessionSummaryRow[]
}

/**
 * Saves a session's summary to `session_summaries`, as before, and to `summary`, anchored to the session's events,
 * in one transaction. Readers still read `session_summaries`; `summary` is what survives regrouping.
 */
export function saveSessionSummary(
  sessionKey: string,
  summary: { engine: StoredEngine; text: string; anchor: SummaryAnchor }
): void {
  saveSummaryToBothStores(getDb(), {
    sourceKey: sessionKey,
    engine: summary.engine,
    text: summary.text,
    createdAt: new Date().toISOString(),
    anchor: summary.anchor,
    anchorSource: 'live',
  })
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
