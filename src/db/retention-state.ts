import type { MigrationDatabase } from './migration-types'
import type { RetentionLimit } from '../config/retention'
import { deleteMetaValue, getMetaValue, setMetaValue } from './jobs/store'

// What the retention run remembers between runs (WOR-179), all in `meta`. `node:sqlite`-free.
const KEEP_FOREVER_KEY = 'retention:keep-forever'
export const LAST_RUN_KEY = 'retention:last-run'
export const ANNOUNCED_AT_KEY = 'retention:announced-at'
export const FIRST_REMOVAL_KEY = 'retention:first-removal'
export const WARNED_KEY = 'retention:warned'
export const SEEN_KEY = 'retention:seen'
// Set when an absence made the announcement start over: that happens once per announcement, not again and again
export const ABSENCE_RESTART_KEY = 'retention:absence-restart'
export const CLEANUP_KEY = 'retention:cleanup'
export const VACUUMED_KEY = 'retention:vacuumed'
const LIMITS_KEY = 'retention:limits'

const KEEP_FOREVER_VALUE = 'true'

/**
 * Keeping everything is written here as well as to config.json. The config file reads as the defaults when it is
 * damaged or deleted, and the defaults remove data; this copy is why that can't happen to someone who opted out.
 */
export function setKeepForeverMirror(db: MigrationDatabase, keepForever: boolean): void {
  if (keepForever) setMetaValue(db, KEEP_FOREVER_KEY, KEEP_FOREVER_VALUE)
  else deleteMetaValue(db, KEEP_FOREVER_KEY)
}

export function isKeepForeverMirrored(db: MigrationDatabase): boolean {
  return getMetaValue(db, KEEP_FOREVER_KEY) !== null
}

/**
 * The limits as Workscribe last saw them, in the database. A config file that is deleted or replaced reads as the
 * defaults, which would remove more than someone who chose a longer limit expects: the run compares against this and
 * removes nothing until the limits are set again.
 */
export function setLimitsSnapshot(db: MigrationDatabase, limits: RetentionLimit): void {
  setMetaValue(db, LIMITS_KEY, JSON.stringify({ days: limits.days, summaryDays: limits.summaryDays }))
}

export function getLimitsSnapshot(db: MigrationDatabase): RetentionLimit | null {
  const stored = getMetaValue(db, LIMITS_KEY)
  if (stored === null) return null
  try {
    const parsed = JSON.parse(stored) as Partial<RetentionLimit>
    return typeof parsed.days === 'number' ? { days: parsed.days, summaryDays: parsed.summaryDays ?? null } : null
  } catch {
    return null
  }
}

/**
 * Whether `after` removes more than `before` did: events or summaries kept for fewer days, or summaries that were kept
 * for ever now limited. What was announced no longer covers it.
 */
export function limitsShortened(before: RetentionLimit, after: RetentionLimit): boolean {
  if (after.days < before.days) return true
  if (after.summaryDays === null) return false
  return before.summaryDays === null || after.summaryDays < before.summaryDays
}

/**
 * Forgets the announcement, the first removal day and the reminders shown, so the next run announces again with a new
 * grace period. For a change that makes the announced date or amount wrong: opting back in, shorter limits, or a long
 * absence.
 */
export function restartAnnouncement(db: MigrationDatabase): void {
  for (const key of [ANNOUNCED_AT_KEY, FIRST_REMOVAL_KEY, WARNED_KEY, ABSENCE_RESTART_KEY]) deleteMetaValue(db, key)
}
