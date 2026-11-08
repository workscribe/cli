import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import { WORKSCRIBE_DIR, DB_PATH } from '../utils/paths'
import { ensurePrivateDirectory } from '../utils/private-directory'
import type { EventRow } from './types'
import { MIGRATIONS } from './migrations'
import { applyMigrations } from './migrate'
import { BUSY_TIMEOUT_MS, withImmediateTransaction, type TransactionOptions } from './transaction'
import type { StoredEngine } from '../ai/engine'
import { insertEventRecord, type NewEvent } from './event-writer'
import { mergeIntoRecentEdit, type RecentEdit } from './edit-merge'
import { saveAnchoredSummary } from './summary-store'
import { countOtherEventsSince, countOtherEventTools, sinceIso } from './recent-events'
import { agentSessionIdsOfDate, agentSessionIdsOfEvents, deleteEmptyAgentSessions } from './agent-sessions'
import { THREAD_ANCHOR_SOURCE, type ThreadAnchor } from '../summary/anchors'
export type { EventRow } from './types'

let _db: DatabaseSync | null = null

export function getDb(): DatabaseSync {
  if (_db) return _db

  // The data folder exists and is private before SQLite creates anything in it
  try {
    ensurePrivateDirectory(WORKSCRIBE_DIR)
  } catch (error) {
    // Rethrown as a clean, actionable message — callers reaching this
    // (explicit commands, or _capture/_hook's own try/catch) otherwise
    // only see a raw native stack trace with the real cause buried in it.
    throw new Error(`Could not create data directory ${WORKSCRIBE_DIR}: ${(error as Error).message}`)
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

export function mergeRecentEdit(edit: RecentEdit): boolean {
  return mergeIntoRecentEdit(getDb(), edit)
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

/** Saves a thread's summary to `summary`, anchored to the thread's events, under the thread's key. */
export function saveThreadSummary(
  threadKey: string,
  summary: { engine: StoredEngine; text: string; anchor: ThreadAnchor }
): void {
  saveAnchoredSummary(getDb(), {
    sourceKey: threadKey,
    engine: summary.engine,
    text: summary.text,
    createdAt: new Date().toISOString(),
    anchor: summary.anchor,
    anchorSource: THREAD_ANCHOR_SOURCE,
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

// The old sessions' links to events (migration 001), until the drop-old-sessions data job removes them: their foreign
// key would refuse to delete an event they point at, so undo and clear remove those links first
const OLD_SESSION_LINKS = 'session_events'

function hasOldSessionLinks(db: DatabaseSync): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(OLD_SESSION_LINKS) !== undefined
  )
}

export function deleteEventsByIds(ids: number[]): void {
  if (ids.length === 0) return
  const db = getDb()
  const placeholders = ids.map(() => '?').join(', ')

  runInImmediateTransaction(() => {
    const agentSessionIds = agentSessionIdsOfEvents(db, ids)
    if (hasOldSessionLinks(db)) {
      db.prepare(`DELETE FROM ${OLD_SESSION_LINKS} WHERE event_id IN (${placeholders})`).run(...ids)
    }
    db.prepare(`DELETE FROM events WHERE id IN (${placeholders})`).run(...ids)
    deleteEmptyAgentSessions(db, agentSessionIds)
  })
}

export function deleteEventsForDate(date: string): number {
  const db = getDb()
  return runInImmediateTransaction(() => {
    const agentSessionIds = agentSessionIdsOfDate(db, date)
    if (hasOldSessionLinks(db)) {
      db.prepare(
        `DELETE FROM ${OLD_SESSION_LINKS}
         WHERE event_id IN (SELECT id FROM events WHERE date(captured_at, 'localtime') = $date)`
      ).run({ date })
    }
    const result = db.prepare(`DELETE FROM events WHERE date(captured_at, 'localtime') = $date`).run({ date }) as {
      changes: number
    }
    deleteEmptyAgentSessions(db, agentSessionIds)
    return result.changes
  })
}

export function getOtherEventToolCounts(days: number): { tool: string; count: number }[] {
  return countOtherEventTools(getDb(), sinceIso(days))
}

export function getRecentOtherRate(days: number): { total: number; otherCount: number } {
  return countOtherEventsSince(getDb(), sinceIso(days))
}
