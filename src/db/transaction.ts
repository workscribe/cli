import type { MigrationDatabase } from './migration-types'

/** How long a connection waits for another process's write lock before failing (`PRAGMA busy_timeout`). */
export const BUSY_TIMEOUT_MS = 5000

// SQLite's SQLITE_BUSY ("database is locked"): another process held the write lock for longer than we waited
const SQLITE_BUSY = 5

export interface TransactionOptions {
  /** Wait at most this long for the write lock, instead of BUSY_TIMEOUT_MS. Restored afterwards. */
  busyTimeoutMs?: number
}

/** Whether an error is SQLite giving up on a write lock another process holds. */
export function isDatabaseLocked(error: unknown): boolean {
  return (error as { errcode?: unknown } | null)?.errcode === SQLITE_BUSY
}

/** Undoes an open transaction. Never throws: the error that made us roll back is the one worth reporting. */
function rollbackQuietly(db: MigrationDatabase): void {
  try {
    db.exec('ROLLBACK')
  } catch {
    // SQLite already rolled back (some errors end the transaction themselves), or the connection is gone
  }
}

/**
 * Runs `read` in a read transaction: one consistent snapshot across its queries, without the write lock — in WAL
 * mode a reader never blocks a writer, however long it reads. An error from `read` is the one thrown, never one from
 * ending the transaction.
 */
export function withReadTransaction<T>(db: MigrationDatabase, read: () => T): T {
  db.exec('BEGIN')
  let result: T
  try {
    result = read()
  } catch (error) {
    rollbackQuietly(db)
    throw error
  }
  db.exec('COMMIT')
  return result
}

/**
 * Runs `work` holding the database's write lock (`BEGIN IMMEDIATE`), so no other process can write in between —
 * `work` should recheck whatever made it start, since another process may have done the job while it waited.
 * Commits on success; rolls back and rethrows on error. Throws a locked error (see `isDatabaseLocked`) if the lock
 * isn't free within the busy timeout. Kept free of `node:sqlite`, so tests run it on any database.
 */
export function withImmediateTransaction<T>(db: MigrationDatabase, work: () => T, options: TransactionOptions = {}): T {
  const { busyTimeoutMs } = options
  if (busyTimeoutMs !== undefined) db.exec(`PRAGMA busy_timeout = ${Math.max(0, Math.floor(busyTimeoutMs))}`)
  try {
    db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      db.exec('COMMIT')
      return result
    } catch (error) {
      rollbackQuietly(db)
      throw error
    }
  } finally {
    if (busyTimeoutMs !== undefined) db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  }
}
