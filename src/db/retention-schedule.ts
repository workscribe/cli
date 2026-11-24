import type { MigrationDatabase } from './migration-types'
import { getMetaValue, setMetaValue } from './jobs/store'
import { cutoffOf } from './retention'
import { WARNED_KEY } from './retention-state'
import { MS_PER_DAY, localDateStr, parseLocalDate } from '../utils/format'

// When removal starts, what the first removal takes and which reminders are due (WOR-179): the calendar side of the
// recurring removal in `retention-run.ts`, which `retention-status.ts` reads too. `node:sqlite`-free.

export const GRACE_DAYS = 14
// How many days before the first removal a reminder is shown, once each
const REMINDER_DAYS = [14, 10, 5, 1]

/** What the first removal will take: the days that have events, and how many events they hold. */
export interface RemovalPreview {
  eventDays: number
  events: number
}

export function addDays(date: string, count: number): string {
  const start = parseLocalDate(date)
  return localDateStr(new Date(start.getFullYear(), start.getMonth(), start.getDate() + count))
}

/** Whole days from `from` to `to`, both local dates (`YYYY-MM-DD`). */
export function daysBetween(from: string, to: string): number {
  const toUtc = (date: string) => {
    const start = parseLocalDate(date)
    return Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())
  }
  return Math.round((toUtc(to) - toUtc(from)) / MS_PER_DAY)
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
  const cutoff = cutoffOf(parseLocalDate(firstRemovalOn), days)
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
export function crossReminders(db: MigrationDatabase, daysUntil: number): boolean {
  const warned = warnedReminders(db)
  const crossed = REMINDER_DAYS.filter((reminderDay) => daysUntil <= reminderDay)
  const isNew = crossed.some((reminderDay) => !warned.includes(reminderDay))
  if (isNew) setMetaValue(db, WARNED_KEY, JSON.stringify([...new Set([...warned, ...crossed])]))
  return isNew
}
