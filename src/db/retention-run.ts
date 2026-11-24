import type { MigrationDatabase } from './migration-types'
import type { DataJob } from './jobs/types'
import { forgetBackups, pruneExpiredBackups } from './jobs/backup'
import { getJobRow, getMetaValue, isJobDone, setMetaValue } from './jobs/store'
import { cutoffOf, removeExpiredEvents, removeExpiredSummaries, removeOrphans, type RemovalStop } from './retention'
import { isFileCleanupPending, requestFileCleanup, runFileCleanup, type FileCleanupStatus } from './retention-cleanup'
import { ANNOUNCED_AT_KEY, FIRST_REMOVAL_KEY, LAST_RUN_KEY, WARNED_KEY, isKeepForeverMirrored } from './retention-state'
import type { RetentionPolicy } from '../config/retention'
import { localDateStr } from '../utils/format'

// The recurring removal of old data (WOR-179), run before the commands that already run data jobs and by `upgrade`;
// never from `_capture`, `_hook`, `context` or `sessions`. The first run on an install only announces and starts the
// clock: nothing is removed for a grace period, or until the first day anything has expired, whichever is later.
// After that it removes whatever has expired, once a day. `node:sqlite`-free: the caller supplies the database, the
// clock, the policy and the jobs.

export const GRACE_DAYS = 14
// How many days before the first removal a reminder is shown, once each
export const REMINDER_DAYS = [14, 10, 5, 1]
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

/** What the first removal will take: the days that have events, and how many events they hold. */
export interface RemovalPreview {
  eventDays: number
  events: number
}

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

export function oldestEventDay(db: MigrationDatabase): string | null {
  const row = db.prepare("SELECT date(MIN(captured_at), 'localtime') AS day FROM events").get() as {
    day: string | null
  }
  return row.day
}

/**
 * The first day anything will be removed: after the grace period, and not before the oldest event is older than the
 * limit. A fresh install has nothing to remove for 100 days, so its first day is the day after that.
 */
export function firstRemovalDay(db: MigrationDatabase, today: string, days: number): string {
  const graceEnds = addDays(today, GRACE_DAYS)
  const firstExpiry = addDays(oldestEventDay(db) ?? today, days + 1)
  return firstExpiry > graceEnds ? firstExpiry : graceEnds
}

/** The events that go on `firstRemovalOn`: those before its cutoff, as `removeExpiredEvents` will see it. */
export function previewOf(db: MigrationDatabase, firstRemovalOn: string, days: number): RemovalPreview {
  const [year, month, day] = firstRemovalOn.split('-').map(Number)
  const cutoff = cutoffOf(new Date(year, month - 1, day), days)
  const row = db
    .prepare(
      "SELECT COUNT(DISTINCT date(captured_at, 'localtime')) AS eventDays, COUNT(*) AS events FROM events WHERE captured_at < ?"
    )
    .get(cutoff) as unknown as RemovalPreview
  return row
}

function warnedReminders(db: MigrationDatabase): number[] {
  try {
    const parsed: unknown = JSON.parse(getMetaValue(db, WARNED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((entry): entry is number => typeof entry === 'number') : []
  } catch {
    return []
  }
}

/**
 * Marks every reminder day that is now `daysUntil` or nearer as shown, and says whether any was new. Skipped days
 * (the CLI wasn't run) cross several at once, which is one reminder, not several.
 */
function crossReminders(db: MigrationDatabase, daysUntil: number): boolean {
  const warned = warnedReminders(db)
  const crossed = REMINDER_DAYS.filter((reminderDay) => daysUntil <= reminderDay)
  const isNew = crossed.some((reminderDay) => !warned.includes(reminderDay))
  if (isNew) setMetaValue(db, WARNED_KEY, JSON.stringify([...new Set([...warned, ...crossed])]))
  return isNew
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
): { days: number; summaryDays: number | null } | { skip: SkipReason } {
  const { policy } = options
  if (policy.status === 'unreadable') return { skip: { kind: 'unreadable', reason: policy.reason } }
  if (policy.retention.keepForever || isKeepForeverMirrored(db)) return { skip: { kind: 'keep-forever' } }
  const paused = pausedBy(db, options.jobs)
  if (paused !== null) return { skip: { kind: 'paused', job: paused } }
  return { days: policy.retention.days, summaryDays: policy.retention.summaryDays }
}

function runRemoval(
  db: MigrationDatabase,
  options: RetentionRunOptions,
  limit: { days: number; summaryDays: number | null },
  today: string
): RetentionOutcome {
  const { days, summaryDays } = limit
  const cutoff = cutoffOf(options.now, days)
  const removal = removeExpiredEvents(db, { cutoff, isOverBudget: options.isOverBudget })
  if (removal.events > 0) requestFileCleanup(db)
  if (removal.stoppedBecause === 'finished') removeOrphans(db, cutoff)
  // Summaries have a limit of their own, none unless it is set; their text can hold what a command did
  const summaries = summaryDays === null ? 0 : removeExpiredSummaries(db, cutoffOf(options.now, summaryDays))
  if (summaries > 0) requestFileCleanup(db)
  const removedBackups = pruneExpiredBackups(options.backupsDirectory, days, options.now)
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
