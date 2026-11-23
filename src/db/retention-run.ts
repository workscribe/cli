import type { MigrationDatabase } from './migration-types'
import type { DataJob } from './jobs/types'
import { forgetBackups, pruneExpiredBackups } from './jobs/backup'
import { getJobRow, getMetaValue, isJobDone, setMetaValue } from './jobs/store'
import { cutoffOf, removeExpiredEvents, removeOrphans, type RemovalStop } from './retention'
import { isFileCleanupPending, requestFileCleanup, runFileCleanup, type FileCleanupStatus } from './retention-cleanup'
import { ANNOUNCED_AT_KEY, FIRST_REMOVAL_KEY, LAST_RUN_KEY, isKeepForeverMirrored } from './retention-state'
import type { RetentionPolicy } from '../config/retention'
import { localDateStr } from '../utils/format'

// The recurring removal of old data (WOR-179), run before the commands that already run data jobs and by `upgrade`;
// never from `_capture`, `_hook`, `context` or `sessions`. The first run on an install only announces and starts the
// clock: nothing is removed for a grace period, or until the first day anything has expired, whichever is later.
// After that it removes whatever has expired, once a day. `node:sqlite`-free: the caller supplies the database, the
// clock, the policy and the jobs.

export const GRACE_DAYS = 14
// The jobs whose work removal must not get ahead of: `summary-anchors` maps summaries onto the events being removed,
// and `summary-days` gives them the day they stay findable by
export const GATE_JOB_NAMES = ['summary-anchors', 'summary-days']

export interface RetentionRunOptions {
  now: Date
  policy: RetentionPolicy
  jobs: DataJob[]
  backupsDirectory: string
  /** Checked between batches: a run that has used its time stops and carries on next time */
  isOverBudget?: () => boolean
  /** Whether the VACUUM may run, which holds the write lock for as long as the file is big */
  canVacuum: boolean
  /** Run again today even if it already ran (`retention run`) */
  ignoreThrottle?: boolean
}

export type SkipReason =
  | { kind: 'keep-forever' }
  | { kind: 'unreadable'; reason: string }
  | { kind: 'paused'; job: string }
  | { kind: 'throttled' }

export type RetentionOutcome =
  | { status: 'skipped'; reason: SkipReason }
  | { status: 'announced'; days: number; firstRemovalOn: string }
  | { status: 'waiting'; days: number; firstRemovalOn: string; daysUntil: number }
  | {
      status: 'ran'
      days: number
      events: number
      backupsRemoved: number
      stoppedBecause: RemovalStop
      cleanup: FileCleanupStatus
    }

export function addDays(date: string, count: number): string {
  const [year, month, day] = date.split('-').map(Number)
  return localDateStr(new Date(year, month - 1, day + count))
}

/** Whole days from `from` to `to`, both local dates (`YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  const toUtc = (date: string) => {
    const [year, month, day] = date.split('-').map(Number)
    return Date.UTC(year, month - 1, day)
  }
  return Math.round((toUtc(to) - toUtc(from)) / (24 * 60 * 60 * 1000))
}

function oldestEventDay(db: MigrationDatabase): string | null {
  const row = db.prepare("SELECT date(MIN(captured_at), 'localtime') AS day FROM events").get() as {
    day: string | null
  }
  return row.day
}

/**
 * The first day anything will be removed: after the grace period, and not before the oldest event is older than the
 * limit. A fresh install has nothing to remove for 100 days, so its first day is the day after that.
 */
function firstRemovalDay(db: MigrationDatabase, today: string, days: number): string {
  const graceEnds = addDays(today, GRACE_DAYS)
  const firstExpiry = addDays(oldestEventDay(db) ?? today, days + 1)
  return firstExpiry > graceEnds ? firstExpiry : graceEnds
}

function pausedBy(db: MigrationDatabase, jobs: DataJob[]): string | null {
  for (const name of GATE_JOB_NAMES) {
    const job = jobs.find((candidate) => candidate.name === name)
    if (job === undefined || !isJobDone(getJobRow(db, name), job)) return name
  }
  return null
}

/** The limit to use, or why nothing is removed. Fails closed: a damaged config, or the opt-out in the database, removes nothing. */
function limitOrReason(db: MigrationDatabase, options: RetentionRunOptions): { days: number } | { skip: SkipReason } {
  const { policy } = options
  if (policy.status === 'unreadable') return { skip: { kind: 'unreadable', reason: policy.reason } }
  if (policy.retention.keepForever || isKeepForeverMirrored(db)) return { skip: { kind: 'keep-forever' } }
  const paused = pausedBy(db, options.jobs)
  return paused === null ? { days: policy.retention.days } : { skip: { kind: 'paused', job: paused } }
}

function runRemoval(
  db: MigrationDatabase,
  options: RetentionRunOptions,
  days: number,
  today: string
): RetentionOutcome {
  const cutoff = cutoffOf(options.now, days)
  const removal = removeExpiredEvents(db, { cutoff, isOverBudget: options.isOverBudget })
  if (removal.events > 0) requestFileCleanup(db)
  if (removal.stoppedBecause === 'finished') removeOrphans(db, cutoff)
  const removedBackups = pruneExpiredBackups(options.backupsDirectory, days, options.now)
  forgetBackups(db, removedBackups)
  const cleanup = isFileCleanupPending(db) ? runFileCleanup(db, { canVacuum: options.canVacuum }) : 'clean'
  // Only a run that finished counts as today's: one stopped by its time or by a lock carries on at the next command
  if (removal.stoppedBecause === 'finished') setMetaValue(db, LAST_RUN_KEY, today)
  return {
    status: 'ran',
    days,
    events: removal.events,
    backupsRemoved: removedBackups.length,
    stoppedBecause: removal.stoppedBecause,
    cleanup,
  }
}

export function runRetention(db: MigrationDatabase, options: RetentionRunOptions): RetentionOutcome {
  const limit = limitOrReason(db, options)
  if ('skip' in limit) return { status: 'skipped', reason: limit.skip }
  const { days } = limit
  const today = localDateStr(options.now)

  const firstRemovalOn = getMetaValue(db, FIRST_REMOVAL_KEY)
  if (firstRemovalOn === null || getMetaValue(db, ANNOUNCED_AT_KEY) === null) {
    const firstDay = firstRemovalDay(db, today, days)
    setMetaValue(db, FIRST_REMOVAL_KEY, firstDay)
    setMetaValue(db, ANNOUNCED_AT_KEY, options.now.toISOString())
    return { status: 'announced', days, firstRemovalOn: firstDay }
  }
  if (today < firstRemovalOn) {
    return { status: 'waiting', days, firstRemovalOn, daysUntil: daysBetween(today, firstRemovalOn) }
  }
  if (!options.ignoreThrottle && getMetaValue(db, LAST_RUN_KEY) === today) {
    return { status: 'skipped', reason: { kind: 'throttled' } }
  }
  return runRemoval(db, options, days, today)
}
