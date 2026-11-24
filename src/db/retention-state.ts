import type { MigrationDatabase } from './migration-types'
import { deleteMetaValue, getMetaValue, setMetaValue } from './jobs/store'

// What the retention run remembers between runs (WOR-179), all in `meta`. `node:sqlite`-free.
export const KEEP_FOREVER_KEY = 'retention:keep-forever'
export const LAST_RUN_KEY = 'retention:last-run'
export const ANNOUNCED_AT_KEY = 'retention:announced-at'
export const FIRST_REMOVAL_KEY = 'retention:first-removal'
export const WARNED_KEY = 'retention:warned'
export const CLEANUP_KEY = 'retention:cleanup'
export const VACUUMED_KEY = 'retention:vacuumed'
export const LIMITS_KEY = 'retention:limits'

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

export interface RetentionLimits {
  days: number
  summaryDays: number | null
}

/**
 * The limits as Workscribe last saw them, in the database. A config file that is deleted or replaced reads as the
 * defaults, which would remove more than someone who chose a longer limit expects: the run compares against this and
 * removes nothing until the limits are set again.
 */
export function setLimitsSnapshot(db: MigrationDatabase, limits: RetentionLimits): void {
  setMetaValue(db, LIMITS_KEY, JSON.stringify({ days: limits.days, summaryDays: limits.summaryDays }))
}

export function getLimitsSnapshot(db: MigrationDatabase): RetentionLimits | null {
  const stored = getMetaValue(db, LIMITS_KEY)
  if (stored === null) return null
  try {
    const parsed = JSON.parse(stored) as Partial<RetentionLimits>
    return typeof parsed.days === 'number' ? { days: parsed.days, summaryDays: parsed.summaryDays ?? null } : null
  } catch {
    return null
  }
}
