import type { MigrationDatabase } from '../migration-types'
import { isDatabaseLocked, withImmediateTransaction, withReadTransaction } from '../transaction'
import { debugLog } from '../../utils/logger'
import { errorMessage } from '../../utils/error-message'
import type { DataJob, JobVerification } from './types'
import { failJob, finishJob, getJobRow, isJobDone, recordJobIssues, setJobCursor, startJob } from './store'

// Small enough that one batch holds the write lock for far less than a capture's 5 s busy timeout
export const DEFAULT_BATCH_SIZE = 500

// A batch waits at most this long for another process's write lock before the run gives up until next time
const BATCH_LOCK_WAIT_MS = 1000

export type JobOutcome = 'done' | 'paused' | 'failed'

export interface JobRunResult {
  name: string
  version: number
  outcome: JobOutcome
  verification?: JobVerification
  error?: string
}

/** Whether this version has a backup: `busy` while another process is taking it, `unavailable` when it failed. */
export type BackupReadiness = 'ready' | 'busy' | 'unavailable'

/** `not-needed`: nothing was pending. `busy` or `unavailable`: no backup for this version yet, so nothing ran. */
export type BackupState = 'not-needed' | BackupReadiness

export interface RunResult {
  backup: BackupState
  jobs: JobRunResult[]
}

export interface RunOptions {
  /** Makes sure a backup exists for this version, taking one if needed. */
  ensureBackup: () => BackupReadiness
  /** Stop starting new batches after this long. Omitted: run every pending job to completion. */
  budgetMs?: number
  batchSize?: number
  now?: () => Date
  /** Called after each batch, and when a job finishes. */
  onProgress?: (progress: { job: DataJob; elapsedMs: number }) => void
}

interface RunContext {
  batchSize: number
  now: () => Date
  isOverBudget: () => boolean
  onProgress: (job: DataJob) => void
}

const NEWER_VERSION_ERROR = 'started by a newer version of Workscribe — update Workscribe to finish it'

/**
 * A newer CLI restarted this job with newer code. Finishing it with this code would mix the two, and the newer CLI
 * would then see it done and never redo it.
 */
class SupersededError extends Error {
  constructor() {
    super(NEWER_VERSION_ERROR)
  }
}

/**
 * Runs one batch holding the write lock. Rereads the job's row inside it, so two processes never redo each other's
 * work, and stops if a newer CLI took the job over since the last batch.
 */
function runLockedBatch(db: MigrationDatabase, job: DataJob, context: RunContext): number | null {
  return withImmediateTransaction(
    db,
    () => {
      const row = getJobRow(db, job.name)
      if (row !== null && row.version !== job.version) throw new SupersededError()
      if (row === null || row.status === 'done') return null
      const batch = job.runBatch(db, row.cursor, context.batchSize)
      recordJobIssues(db, job, batch.issues, context.now().toISOString())
      if (batch.lastId !== null) setJobCursor(db, job.name, batch.lastId)
      return batch.lastId
    },
    { busyTimeoutMs: BATCH_LOCK_WAIT_MS }
  )
}

/** Checks the job's work without the write lock — a full-table check never blocks a capture. */
function finish(db: MigrationDatabase, job: DataJob, context: RunContext): JobRunResult {
  const verification = withReadTransaction(db, () => job.verify(db))
  const isFinished = withImmediateTransaction(db, () => finishJob(db, job, verification, context.now().toISOString()))
  if (!isFinished) throw new SupersededError()
  context.onProgress(job)
  return { name: job.name, version: job.version, outcome: 'done', verification }
}

function runJob(db: MigrationDatabase, job: DataJob, context: RunContext): JobRunResult {
  const summary = { name: job.name, version: job.version }
  // Checked here before `startJob` would touch the row, and again in every batch and when finishing
  const storedVersion = getJobRow(db, job.name)?.version ?? 0
  if (storedVersion > job.version) return { ...summary, outcome: 'paused', error: NEWER_VERSION_ERROR }
  try {
    withImmediateTransaction(db, () => startJob(db, job, context.now().toISOString()))
    // After `startJob`, so a version bump's `prepare` clears the old work before `gather` builds on it
    if (job.gather?.(db, { isOverBudget: context.isOverBudget }) === 'incomplete')
      return { ...summary, outcome: 'paused' }
    while (runLockedBatch(db, job, context) !== null) {
      context.onProgress(job)
      if (context.isOverBudget()) return { ...summary, outcome: 'paused' }
    }
    return finish(db, job, context)
  } catch (error) {
    if (error instanceof SupersededError) return { ...summary, outcome: 'paused', error: error.message }
    // Another process holding the lock (a capture, or the same job elsewhere) isn't a failure: try again next time
    if (isDatabaseLocked(error)) return { ...summary, outcome: 'paused' }
    const message = errorMessage(error)
    recordFailure(db, job, message)
    return { ...summary, outcome: 'failed', error: message }
  }
}

/** Stores the failure for `status`. If even that write fails, the run still reports the original error. */
function recordFailure(db: MigrationDatabase, job: DataJob, message: string): void {
  try {
    failJob(db, job, message)
  } catch (error) {
    debugLog(`data job ${job.name}: couldn't record the failure`, error)
  }
}

/** Only for done jobs. Another process holding the lock, or any other error, just leaves the cleanup for next time. */
function runPendingCleanups(db: MigrationDatabase, jobs: DataJob[]): void {
  for (const job of jobs) {
    if (!job.cleanup || !isJobDone(getJobRow(db, job.name), job)) continue
    try {
      if (job.cleanup.isPending(db)) job.cleanup.run(db)
    } catch (error) {
      debugLog(`data job ${job.name}: cleanup`, error)
    }
  }
}

/**
 * Runs the pending jobs in order, stopping at the first one that doesn't finish, so a job can rely on every job
 * before it. Nothing runs unless `ensureBackup` confirms a backup. Each batch commits on its own: an interrupted run
 * resumes from the last batch it committed. Done jobs' cleanups run last, retried until they finish.
 */
export function runPendingJobs(db: MigrationDatabase, jobs: DataJob[], options: RunOptions): RunResult {
  const pending = jobs.filter((job) => !isJobDone(getJobRow(db, job.name), job))
  if (pending.length === 0) {
    runPendingCleanups(db, jobs)
    return { backup: 'not-needed', jobs: [] }
  }
  const backup = options.ensureBackup()
  if (backup !== 'ready') return { backup, jobs: [] }

  const now = options.now ?? (() => new Date())
  const startedAt = now().getTime()
  const context: RunContext = {
    batchSize: options.batchSize ?? DEFAULT_BATCH_SIZE,
    now,
    isOverBudget: () => options.budgetMs !== undefined && now().getTime() - startedAt >= options.budgetMs,
    onProgress: (job) => options.onProgress?.({ job, elapsedMs: now().getTime() - startedAt }),
  }

  const results: JobRunResult[] = []
  for (const job of pending) {
    const result = runJob(db, job, context)
    results.push(result)
    if (result.outcome !== 'done') break
  }
  runPendingCleanups(db, jobs)
  return { backup: 'ready', jobs: results }
}
