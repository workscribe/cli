import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { WORKSCRIBE_DIR, DB_PATH } from '../utils/paths'
export type { EventRow, SessionRow } from './types'

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db

  // Ensure ~/.chronicle/ exists
  if (!fs.existsSync(WORKSCRIBE_DIR)) {
    fs.mkdirSync(WORKSCRIBE_DIR, { recursive: true })
  }

  _db = new DatabaseSync(DB_PATH)
  _db.exec('PRAGMA journal_mode = WAL')
  _db.exec('PRAGMA foreign_keys = ON')
  runMigrations(_db)
  return _db
}

function runMigrations(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at TEXT    NOT NULL,
      command     TEXT    NOT NULL,
      cwd         TEXT    NOT NULL,
      exit_code   INTEGER,
      duration_ms INTEGER,
      repo_name   TEXT,
      branch      TEXT,
      category    TEXT    NOT NULL DEFAULT 'other',
      metadata    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_captured_at ON events(captured_at);
    CREATE INDEX IF NOT EXISTS idx_events_repo_name   ON events(repo_name);

    CREATE TABLE IF NOT EXISTS sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT    NOT NULL,
      started_at  TEXT    NOT NULL,
      ended_at    TEXT    NOT NULL,
      repo_name   TEXT,
      event_count INTEGER NOT NULL DEFAULT 0,
      summary     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);

    CREATE TABLE IF NOT EXISTS session_events (
      session_id  INTEGER NOT NULL REFERENCES sessions(id),
      event_id    INTEGER NOT NULL REFERENCES events(id),
      PRIMARY KEY (session_id, event_id)
    );
  `)
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
}): void {
  const db = getDb()
  const stmt = db.prepare(`
    INSERT INTO events (captured_at, command, cwd, exit_code, duration_ms, repo_name, branch, category, metadata)
    VALUES ($captured_at, $command, $cwd, $exit_code, $duration_ms, $repo_name, $branch, $category, $metadata)
  `)
  stmt.run(params)
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
    WHERE date(captured_at) = $date
    ORDER BY captured_at ASC
  `)
  return stmt.all({ date }) as EventRow[]
}

export function getRecentEvents(limit = 20): EventRow[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM events ORDER BY captured_at DESC LIMIT $limit')
  return stmt.all({ limit }) as EventRow[]
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

export function getSessionsForDate(date: string): SessionRow[] {
  const db = getDb()
  const stmt = db.prepare('SELECT * FROM sessions WHERE date = $date ORDER BY started_at ASC')
  return stmt.all({ date }) as SessionRow[]
}

export function updateSessionSummary(sessionId: number, summary: string): void {
  const db = getDb()
  const stmt = db.prepare('UPDATE sessions SET summary = $summary WHERE id = $id')
  stmt.run({ summary, id: sessionId })
}

export function clearSessionsForDate(date: string): void {
  const db = getDb()
  // Remove session_events first due to FK constraint
  db.exec(`
    DELETE FROM session_events WHERE session_id IN (
      SELECT id FROM sessions WHERE date = '${date.replace(/'/g, "''")}'
    )
  `)
  db.exec(`DELETE FROM sessions WHERE date = '${date.replace(/'/g, "''")}'`)
}
