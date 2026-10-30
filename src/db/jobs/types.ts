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

/**
 * Data work that normalises what's already stored: batched, resumable, idempotent. Every function reads only the
 * database — never the user's config or the clock — so a rerun gives the same result.
 */
export interface DataJob {
  name: string
  /** Bump to rerun the job over every row: `prepare` clears what the earlier version wrote. */
  version: number
  description: string
  prepare(db: MigrationDatabase): void
  /** Handles up to `limit` rows with an id above `afterId`, in id order. */
  runBatch(db: MigrationDatabase, afterId: number, limit: number): BatchResult
  verify(db: MigrationDatabase): JobVerification
}
