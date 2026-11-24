import type { MigrationDatabase } from './migration-types'
import type { DataJob } from './jobs/types'
import { getMetaValue } from './jobs/store'
import { lostLimitsProblem, pausedBy } from './retention-run'
import { addDays, firstRemovalDay, oldestEventDay, previewOf, type RemovalPreview } from './retention-schedule'
import { ANNOUNCED_AT_KEY, FIRST_REMOVAL_KEY, LAST_RUN_KEY, isKeepForeverMirrored } from './retention-state'
import type { RetentionLimit, RetentionPolicy } from '../config/retention'
import { localDateStr } from '../utils/format'

// What `status` and `workscribe retention` say about the removal of old data (WOR-179): the policy, the oldest day that
// is still kept and when it goes, and what the next removal takes. Read only: it never changes anything. `node:sqlite`-free.

export type RetentionMode = 'keep-forever' | 'unreadable' | 'paused' | 'waiting' | 'removing'

export interface RetentionStatus {
  mode: RetentionMode
  /** How many days events are kept; null when the config can't be read, so there is no limit to name */
  days: number | null
  summaryDays: number | null
  /** Why the config can't be used (`unreadable`) */
  reason: string | null
  /** The data job removal is waiting for (`paused`) */
  pausedBy: string | null
  /** The local day of the oldest stored event */
  oldestDay: string | null
  /** The day that event is removed on: its own, but never before removal starts */
  oldestDayRemovedOn: string | null
  /** The day removal starts, once it is known */
  startsOn: string | null
  /** What the next removal takes, and the day it happens on */
  next: (RemovalPreview & { on: string }) | null
}

interface StatusOptions {
  now: Date
  policy: RetentionPolicy
  jobs: DataJob[]
}

const COUNTING_MODES: RetentionMode[] = ['waiting', 'removing', 'paused']

function modeOf(db: MigrationDatabase, options: StatusOptions, startsOn: string, today: string): RetentionMode {
  const { policy } = options
  if (policy.status === 'unreadable') return 'unreadable'
  if (policy.retention.keepForever || isKeepForeverMirrored(db)) return 'keep-forever'
  if (pausedBy(db, options.jobs) !== null) return 'paused'
  return today < startsOn ? 'waiting' : 'removing'
}

/** The day the next removal happens: today if it has not run yet, tomorrow if it has, else the day removal starts. */
function nextRemovalDay(db: MigrationDatabase, mode: RetentionMode, startsOn: string, today: string): string {
  if (mode !== 'removing') return startsOn
  return getMetaValue(db, LAST_RUN_KEY) === today ? addDays(today, 1) : today
}

/** The day the oldest event goes: its own, but never before removal starts. */
function oldestDayRemovedOn(oldestDay: string | null, days: number, startsOn: string): string | null {
  if (oldestDay === null) return null
  const expiresOn = addDays(oldestDay, days + 1)
  return expiresOn > startsOn ? expiresOn : startsOn
}

function unreadableStatus(db: MigrationDatabase, reason: string): RetentionStatus {
  return {
    mode: 'unreadable',
    days: null,
    summaryDays: null,
    reason,
    pausedBy: null,
    oldestDay: oldestEventDay(db),
    oldestDayRemovedOn: null,
    startsOn: null,
    next: null,
  }
}

export function retentionStatusOf(db: MigrationDatabase, options: StatusOptions): RetentionStatus {
  const { policy } = options
  if (policy.status === 'unreadable') return unreadableStatus(db, policy.reason)
  const { days, summaryDays }: RetentionLimit = policy.retention
  const lost = lostLimitsProblem(db, { days, summaryDays, isDefault: policy.isDefault })
  if (lost !== null) return unreadableStatus(db, lost)
  const today = localDateStr(options.now)
  const stored = getMetaValue(db, FIRST_REMOVAL_KEY)
  const startsOn =
    getMetaValue(db, ANNOUNCED_AT_KEY) !== null && stored !== null ? stored : firstRemovalDay(db, today, days)
  const mode = modeOf(db, options, startsOn, today)
  const oldestDay = oldestEventDay(db)
  if (!COUNTING_MODES.includes(mode)) {
    return { ...unreadableStatus(db, ''), mode, days, summaryDays, reason: null, oldestDay }
  }
  const nextDay = nextRemovalDay(db, mode, startsOn, today)
  return {
    mode,
    days,
    summaryDays,
    reason: null,
    pausedBy: mode === 'paused' ? pausedBy(db, options.jobs) : null,
    oldestDay,
    oldestDayRemovedOn: oldestDayRemovedOn(oldestDay, days, startsOn),
    startsOn,
    next: { on: nextDay, ...previewOf(db, nextDay, days) },
  }
}
