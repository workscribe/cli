import type { MigrationDatabase } from './migration-types'
import type { DataJob } from './jobs/types'
import { getMetaValue } from './jobs/store'
import { addDays, firstRemovalDay, oldestEventDay, pausedBy, previewOf, type RemovalPreview } from './retention-run'
import { ANNOUNCED_AT_KEY, FIRST_REMOVAL_KEY, LAST_RUN_KEY, isKeepForeverMirrored } from './retention-state'
import type { RetentionPolicy } from '../config/retention'
import { localDateStr } from '../utils/format'

// What `status` and `workscribe retention` say about the removal of old data (WOR-179): the policy, the oldest day that
// is still kept and when it goes, and what the next removal takes. Read only: it never changes anything. `node:sqlite`-free.

export type RetentionMode = 'keep-forever' | 'unreadable' | 'paused' | 'waiting' | 'removing'

export interface RetentionStatus {
  mode: RetentionMode
  days: number
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

function daysOf(policy: RetentionPolicy): { days: number; summaryDays: number | null } {
  return policy.status === 'ok'
    ? { days: policy.retention.days, summaryDays: policy.retention.summaryDays }
    : { days: 0, summaryDays: null }
}

function modeOf(db: MigrationDatabase, options: StatusOptions, startsOn: string, today: string): RetentionMode {
  const { policy } = options
  if (policy.status === 'unreadable') return 'unreadable'
  if (policy.retention.keepForever || isKeepForeverMirrored(db)) return 'keep-forever'
  if (pausedBy(db, options.jobs) !== null) return 'paused'
  return today < startsOn ? 'waiting' : 'removing'
}

export function retentionStatusOf(db: MigrationDatabase, options: StatusOptions): RetentionStatus {
  const { days, summaryDays } = daysOf(options.policy)
  const today = localDateStr(options.now)
  const announced = getMetaValue(db, ANNOUNCED_AT_KEY) !== null
  const stored = getMetaValue(db, FIRST_REMOVAL_KEY)
  const startsOn = announced && stored !== null ? stored : firstRemovalDay(db, today, days)
  const mode = modeOf(db, options, startsOn, today)
  const oldestDay = oldestEventDay(db)
  const isCounting = mode === 'waiting' || mode === 'removing' || mode === 'paused'
  const expiresOn = oldestDay === null ? null : addDays(oldestDay, days + 1)
  const ranToday = getMetaValue(db, LAST_RUN_KEY) === today
  const nextDay = mode === 'removing' ? (ranToday ? addDays(today, 1) : today) : startsOn
  return {
    mode,
    days,
    summaryDays,
    reason: options.policy.status === 'unreadable' ? options.policy.reason : null,
    pausedBy: mode === 'paused' ? pausedBy(db, options.jobs) : null,
    oldestDay,
    oldestDayRemovedOn: expiresOn === null || !isCounting ? null : expiresOn > startsOn ? expiresOn : startsOn,
    startsOn: isCounting ? startsOn : null,
    next: isCounting ? { on: nextDay, ...previewOf(db, nextDay, days) } : null,
  }
}
