import type { MigrationDatabase } from './migration-types'
import { deleteEventRows } from './event-delete'
import { isDatabaseLocked, withImmediateTransaction } from './transaction'
import { localDateOf } from '../utils/format'

// Removes captured events once they are older than the retention limit (WOR-179), and what hangs off them. Never called
// from `_capture`, `_hook`, `context` or `sessions`. A run is a series of short transactions, so the write lock is held
// for one batch at a time and a capture that arrives between two batches gets in. `node:sqlite`-free.

export const REMOVAL_BATCH_SIZE = 500
// A batch waits this long for the write lock, well under the 5 s a capture waits for it, and gives up the run when it
// doesn't get it: a capture that is writing always goes first
const BATCH_LOCK_WAIT_MS = 1000

/**
 * The start of the local day `days` days before `now`, as `captured_at` is stored. Whole days: an event is removed only
 * once its whole day is past the limit, so a day is never half there. A DST change moves the hour, never the day.
 */
export function cutoffOf(now: Date, days: number): string {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - days).toISOString()
}

export interface RemovalOptions {
  /** Events captured before this are removed (`cutoffOf`) */
  cutoff: string
  batchSize?: number
  /** Checked between batches: a run that has used its time stops and carries on next time */
  isOverBudget?: () => boolean
}

export type RemovalStop = 'finished' | 'over-budget' | 'locked'

export interface RemovalResult {
  events: number
  stoppedBecause: RemovalStop
}

function expiredEventIds(db: MigrationDatabase, cutoff: string, limit: number): number[] {
  const rows = db
    .prepare('SELECT id FROM events WHERE captured_at < ? ORDER BY captured_at, id LIMIT ?')
    .all(cutoff, limit) as { id: number }[]
  return rows.map((row) => row.id)
}

/** SQLite zeroes the content of what is deleted while this is on, so the text doesn't stay in the file's free pages. */
function withSecureDelete<T>(db: MigrationDatabase, work: () => T): T {
  const previous = db.prepare('PRAGMA secure_delete').get() as { secure_delete: number }
  db.exec('PRAGMA secure_delete = ON')
  try {
    return work()
  } finally {
    db.exec(`PRAGMA secure_delete = ${previous.secure_delete}`)
  }
}

/** Removes the events before the cutoff, oldest first, in batches of their own transactions. */
export function removeExpiredEvents(db: MigrationDatabase, options: RemovalOptions): RemovalResult {
  const batchSize = options.batchSize ?? REMOVAL_BATCH_SIZE
  let removed = 0
  const stop = (stoppedBecause: RemovalStop): RemovalResult => ({ events: removed, stoppedBecause })
  return withSecureDelete(db, () => {
    for (;;) {
      if (options.isOverBudget?.()) return stop('over-budget')
      const ids = expiredEventIds(db, options.cutoff, batchSize)
      if (ids.length === 0) return stop('finished')
      try {
        withImmediateTransaction(db, () => deleteEventRows(db, ids), { busyTimeoutMs: BATCH_LOCK_WAIT_MS })
      } catch (error) {
        if (isDatabaseLocked(error)) return stop('locked')
        throw error
      }
      removed += ids.length
    }
  })
}

export interface OrphanCounts {
  files: number
  branches: number
  alerts: number
  derivedDays: number
}

function changesOf(result: unknown): number {
  return (result as { changes: number }).changes
}

/**
 * What no event refers to any more, and what was derived from the removed days. Projects are kept: a summary points at
 * one, and its name is not what was captured. A day's blocks and slots are rebuilt from its events, so those for a day
 * before the cutoff are only left over.
 */
export function removeOrphans(db: MigrationDatabase, cutoff: string): OrphanCounts {
  const firstKeptDay = localDateOf(cutoff)
  return withSecureDelete(db, () =>
    withImmediateTransaction(db, () => {
      const files = changesOf(db.prepare('DELETE FROM file WHERE id NOT IN (SELECT file_id FROM event_file)').run())
      const branches = changesOf(
        db
          .prepare(
            `DELETE FROM branch
             WHERE id NOT IN (SELECT branch_id FROM events WHERE branch_id IS NOT NULL)
               AND id NOT IN (SELECT branch_id FROM ticket_ref WHERE branch_id IS NOT NULL)`
          )
          .run()
      )
      const alerts = changesOf(db.prepare('DELETE FROM alerts WHERE created_at < ?').run(Date.parse(cutoff)))
      const blocks = changesOf(db.prepare('DELETE FROM work_block WHERE date < ?').run(firstKeptDay))
      db.prepare('DELETE FROM activity_slot WHERE date < ?').run(firstKeptDay)
      db.prepare('DELETE FROM grouping_day WHERE date < ?').run(firstKeptDay)
      return { files, branches, alerts, derivedDays: blocks }
    })
  )
}

/**
 * Removes the saved summaries of days before the cutoff, for `retention.summaryDays`. A summary whose day is not known
 * (null) is never removed: it can't be said to be old. Returns how many went.
 */
export function removeExpiredSummaries(db: MigrationDatabase, cutoff: string): number {
  const firstKeptDay = localDateOf(cutoff)
  return withSecureDelete(db, () =>
    withImmediateTransaction(db, () => changesOf(db.prepare('DELETE FROM summary WHERE day < ?').run(firstKeptDay)))
  )
}
