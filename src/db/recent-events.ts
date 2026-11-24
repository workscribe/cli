import type { MigrationDatabase } from './migration-types'
import { MS_PER_DAY } from '../utils/format'

// Counts over the last few days of events, for `status` and `profile`. The window starts at an ISO timestamp, the
// same format `captured_at` is stored in: compared with SQLite's `datetime()` text ("2026-11-02 10:00:00"), every
// event of the boundary day would pass, since 'T' sorts after ' '. `node:sqlite`-free, so tests run it in memory.

/** The start of the last `days` days, as `captured_at` is stored. */
export function sinceIso(days: number, now: number = Date.now()): string {
  return new Date(now - days * MS_PER_DAY).toISOString()
}

export function countOtherEventTools(db: MigrationDatabase, since: string): { tool: string; count: number }[] {
  return db
    .prepare(
      `SELECT json_extract(metadata, '$.tool') as tool, COUNT(*) as count
       FROM events
       WHERE category = 'other'
         AND captured_at >= ?
         AND json_extract(metadata, '$.tool') IS NOT NULL
       GROUP BY tool
       ORDER BY count DESC`
    )
    .all(since) as { tool: string; count: number }[]
}

export function countOtherEventsSince(db: MigrationDatabase, since: string): { total: number; otherCount: number } {
  return db
    .prepare(
      `SELECT COUNT(*) as total,
              SUM(CASE WHEN category = 'other' THEN 1 ELSE 0 END) as otherCount
       FROM events
       WHERE captured_at >= ?`
    )
    .get(since) as { total: number; otherCount: number }
}
