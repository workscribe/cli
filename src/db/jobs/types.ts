import type { MigrationDatabase } from '../migration-types'

/** A row a job couldn't resolve. Recorded in `data_job_issues` and never deleted. */
export interface JobIssue {
  reference: string
  reason: string
}

export interface BatchResult {
  /** The id of the last row this batch handled, or null when no rows were left — the job is done. */
  lastId: number | null
  issues: JobIssue[]
}

export interface JobVerification {
  checked: number
  resolved: number
  unresolved: number
  /** False when the counts show data went missing — not merely that some rows were unresolved. */
  hasPassed: boolean
  notes: string[]
}

export type GatherOutcome = 'complete' | 'incomplete'

/**
 * Data work that normalises what's already stored: batched, resumable, idempotent. It never reads the user's config
 * or the clock, and anything it learns from outside the database (say, from git) is cached in the database first, so
 * a rerun gives the same result.
 */
export interface DataJob {
  name: string
  /** Bump to rerun the job over every row: `prepare` clears what the earlier version wrote. */
  version: number
  description: string
  prepare(db: MigrationDatabase): void
  /**
   * Slow work outside the database, done before any batch: runs outside every transaction, so it never holds the
   * write lock, and caches what it learns. `incomplete` pauses the job until the next run, which carries on.
   */
  gather?(db: MigrationDatabase, context: { isOverBudget: () => boolean }): GatherOutcome
  /** Handles up to `limit` rows with an id above `afterId`, in id order. */
  runBatch(db: MigrationDatabase, afterId: number, limit: number): BatchResult
  verify(db: MigrationDatabase): JobVerification
  /**
   * Work left once the job is done, like rewriting the file. It runs outside every transaction, whenever a data command
   * finds it pending, so a busy or interrupted attempt is retried. An error is logged, and never fails the job.
   */
  cleanup?: {
    isPending(db: MigrationDatabase): boolean
    run(db: MigrationDatabase): void
  }
}
