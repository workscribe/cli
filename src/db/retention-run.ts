import type { MigrationDatabase } from './migration-types'
import type { DataJob } from './jobs/types'
import { forgetBackups, pruneExpiredBackups } from './jobs/backup'
import { getJobRow, getMetaValue, isJobDone, setMetaValue } from './jobs/store'
import { cutoffOf, removeExpiredEvents, removeExpiredSummaries, removeOrphans, type RemovalStop } from './retention'
import { isFileCleanupPending, requestFileCleanup, runFileCleanup, type FileCleanupStatus } from './retention-cleanup'
import {
  ANNOUNCED_AT_KEY,
  FIRST_REMOVAL_KEY,
  LAST_RUN_KEY,
  SEEN_KEY,
  getLimitsSnapshot,
  isKeepForeverMirrored,
  restartAnnouncement,
  setLimitsSnapshot,
} from './retention-state'
import {
  GRACE_DAYS,
  crossReminders,
  daysBetween,
  firstRemovalDay,
  previewOf,
  type RemovalPreview,
} from './retention-schedule'
import type { RetentionLimit, RetentionPolicy } from '../config/retention'
import { localDateStr } from '../utils/format'

// The recurring removal of old data (WOR-179), run before the commands that already run data jobs and by `upgrade`;
// never from `_capture`, `_hook`, `context` or `sessions`. The first run on an install only announces and starts the
// clock: nothing is removed for a grace period, or until the first day anything has expired, whichever is later.
// After that it removes whatever has expired, once a day. `node:sqlite`-free: the caller supplies the database, the
// clock, the policy and the jobs.

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
  /** Called right before a VACUUM this run does, to warn that captures may be lost while it runs */
  beforeVacuum?: () => void
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
  | { status: 'announced'; days: number; firstRemovalOn: string; preview: RemovalPreview }
  | {
      status: 'waiting'
      days: number
      firstRemovalOn: string
      daysUntil: number
      /** Set on the one run that crosses a reminder day (`REMINDER_DAYS`), never twice for the same one */
      reminder: RemovalPreview | null
    }
  | {
      status: 'ran'
      days: number
      events: number
      summaries: number
      backupsRemoved: number
      stoppedBecause: RemovalStop
      cleanup: FileCleanupStatus
    }

export function pausedBy(db: MigrationDatabase, jobs: DataJob[]): string | null {
  for (const name of GATE_JOB_NAMES) {
    const job = jobs.find((candidate) => candidate.name === name)
    if (job === undefined || !isJobDone(getJobRow(db, name), job)) return name
  }
  return null
}

/** The limit to use, or why nothing is removed. Fails closed: a damaged config, or the opt-out in the database, removes nothing. */
function limitOrReason(
  db: MigrationDatabase,
  options: RetentionRunOptions
): (RetentionLimit & { isDefault: boolean }) | { skip: SkipReason } {
  const { policy } = options
  if (policy.status === 'unreadable') return { skip: { kind: 'unreadable', reason: policy.reason } }
  if (policy.retention.keepForever || isKeepForeverMirrored(db)) return { skip: { kind: 'keep-forever' } }
  const paused = pausedBy(db, options.jobs)
  if (paused !== null) return { skip: { kind: 'paused', job: paused } }
  return { days: policy.retention.days, summaryDays: policy.retention.summaryDays, isDefault: policy.isDefault }
}

/**
 * The time removal counts from: now, but never later than the end of the day of the newest event Workscribe holds (or,
 * with none, of the day removal was announced). A clock that jumps forward (a resumed virtual machine, a bad time
 * server, a mistyped year) would otherwise make everything look expired at once, and nothing can undo that. This way a
 * wrong clock can remove nothing that was not already due by the time of the last thing captured, and a day's gap in
 * use only delays removal by that gap.
 */
export function referenceNowOf(db: MigrationDatabase, now: Date): Date {
  const newest = db.prepare('SELECT MAX(captured_at) AS capturedAt FROM events').get() as { capturedAt: string | null }
  const lastActive = newest.capturedAt ?? getMetaValue(db, ANNOUNCED_AT_KEY)
  if (lastActive === null) return now
  const lastDay = new Date(lastActive)
  const endOfLastDay = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate() + 1)
  return endOfLastDay < now ? endOfLastDay : now
}

function runRemoval(
  db: MigrationDatabase,
  options: RetentionRunOptions,
  limit: RetentionLimit,
  today: string
): RetentionOutcome {
  const { days, summaryDays } = limit
  const referenceNow = referenceNowOf(db, options.now)
  const cutoff = cutoffOf(referenceNow, days)
  const removal = removeExpiredEvents(db, { cutoff, isOverBudget: options.isOverBudget })
  if (removal.events > 0) requestFileCleanup(db)
  if (removal.stoppedBecause === 'finished') removeOrphans(db, cutoff)
  // Summaries have a limit of their own, none unless it is set; their text can hold what a command did
  const summaries = summaryDays === null ? 0 : removeExpiredSummaries(db, cutoffOf(referenceNow, summaryDays))
  if (summaries > 0) requestFileCleanup(db)
  const removedBackups = pruneExpiredBackups(options.backupsDirectory, days, referenceNow)
  forgetBackups(db, removedBackups)
  const cleanup = isFileCleanupPending(db)
    ? runFileCleanup(db, { canVacuum: options.canVacuum, beforeVacuum: options.beforeVacuum })
    : 'clean'
  // Only a run that finished counts as today's: one stopped by its time or by a lock carries on at the next command
  if (removal.stoppedBecause === 'finished') setMetaValue(db, LAST_RUN_KEY, today)
  return {
    status: 'ran',
    days,
    events: removal.events,
    summaries,
    backupsRemoved: removedBackups.length,
    stoppedBecause: removal.stoppedBecause,
    cleanup,
  }
}

/**
 * Why a config that says nothing about retention can't be trusted: Workscribe saw other limits before, so the file was
 * deleted, replaced or edited, and the defaults would remove more than the person chose. Null when it can.
 */
export function lostLimitsProblem(
  db: MigrationDatabase,
  limit: RetentionLimit & { isDefault: boolean }
): string | null {
  if (!limit.isDefault) return null
  const seen = getLimitsSnapshot(db)
  if (seen === null || (seen.days === limit.days && seen.summaryDays === limit.summaryDays)) return null
  return `retention is missing from config.json; it was ${seen.days} days when Workscribe last saw it. Set it again with: workscribe config set retention.days ${seen.days}`
}

/**
 * Someone away for longer than the grace period saw none of the reminders, and the date announced may have passed. If
 * something is due now, announce again instead of removing it unannounced.
 */
function restartAfterAbsence(db: MigrationDatabase, today: string, days: number): void {
  const lastSeen = getMetaValue(db, SEEN_KEY)
  if (lastSeen === null || daysBetween(lastSeen, today) <= GRACE_DAYS) return
  if (previewOf(db, today, days).events > 0) restartAnnouncement(db)
}

export function runRetention(db: MigrationDatabase, options: RetentionRunOptions): RetentionOutcome {
  const limit = limitOrReason(db, options)
  if ('skip' in limit) return { status: 'skipped', reason: limit.skip }
  const lost = lostLimitsProblem(db, limit)
  if (lost !== null) return { status: 'skipped', reason: { kind: 'unreadable', reason: lost } }
  const { days } = limit
  const today = localDateStr(options.now)

  restartAfterAbsence(db, today, days)
  setMetaValue(db, SEEN_KEY, today)

  const firstRemovalOn = getMetaValue(db, FIRST_REMOVAL_KEY)
  if (firstRemovalOn === null || getMetaValue(db, ANNOUNCED_AT_KEY) === null) {
    const firstDay = firstRemovalDay(db, today, days)
    setMetaValue(db, FIRST_REMOVAL_KEY, firstDay)
    setMetaValue(db, ANNOUNCED_AT_KEY, options.now.toISOString())
    setLimitsSnapshot(db, limit)
    // The announcement is the reminder for every day it is already inside of
    crossReminders(db, daysBetween(today, firstDay))
    return { status: 'announced', days, firstRemovalOn: firstDay, preview: previewOf(db, firstDay, days) }
  }
  if (today < firstRemovalOn) {
    const daysUntil = daysBetween(today, firstRemovalOn)
    const reminder = crossReminders(db, daysUntil) ? previewOf(db, firstRemovalOn, days) : null
    return { status: 'waiting', days, firstRemovalOn, daysUntil, reminder }
  }
  if (!options.ignoreThrottle && getMetaValue(db, LAST_RUN_KEY) === today) {
    return { status: 'skipped', reason: { kind: 'throttled' } }
  }
  return runRemoval(db, options, limit, today)
}
