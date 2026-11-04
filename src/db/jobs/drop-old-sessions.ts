import type { MigrationDatabase } from '../migration-types'
import type { BatchResult, DataJob, JobVerification } from './types'
import { getJobRow, getMetaValue, isJobDone, setMetaValue } from './store'
import { summaryAnchorsJob } from './summary-anchors'

// Drops the linear sessions (WOR-151): nothing has read them since every reader moved onto threads, and their
// saved summaries live on in `summary`. It only runs once `summary-anchors` copied every old summary there and its
// check passed, after the runner's backup of this version — so dropping can never lose a summary.

/**
 * In drop order: `session_events` references `sessions`. `sessions.summary` goes with its table. The queries below
 * interpolate these names: they're constants, and SQLite can't bind a table name.
 */
export const OLD_TABLES = ['session_events', 'sessions', 'session_summaries']
const DROPPED_ROWS_KEY = 'drop-old-sessions:dropped'

export const OLD_SUMMARIES_NOT_COPIED =
  "Old summaries aren't all copied yet — the old session tables are kept. Run workscribe bug-report to report it."

interface DroppedTable {
  name: string
  rows: number
}

function existingOldTables(db: MigrationDatabase): string[] {
  return OLD_TABLES.filter(
    (name) => db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined
  )
}

/** `summary-anchors` is done at its current version, and its check found every old summary copied. */
function areOldSummariesCopied(db: MigrationDatabase): boolean {
  const row = getJobRow(db, summaryAnchorsJob.name)
  if (!isJobDone(row, summaryAnchorsJob) || !row?.verification) return false
  return (JSON.parse(row.verification) as JobVerification).hasPassed
}

/** The one batch: refuses — failing the job, which retries next run — until the summaries are safe. */
function runBatch(db: MigrationDatabase): BatchResult {
  if (!areOldSummariesCopied(db)) throw new Error(OLD_SUMMARIES_NOT_COPIED)
  const dropped: DroppedTable[] = existingOldTables(db).map((name) => ({
    name,
    rows: (db.prepare(`SELECT COUNT(*) AS rows FROM ${name}`).get() as { rows: number }).rows,
  }))
  for (const name of OLD_TABLES) db.exec(`DROP TABLE IF EXISTS ${name}`)
  if (dropped.length > 0) setMetaValue(db, DROPPED_ROWS_KEY, JSON.stringify(dropped))
  return { lastId: null, issues: [] }
}

function verify(db: MigrationDatabase): JobVerification {
  const dropped = JSON.parse(getMetaValue(db, DROPPED_ROWS_KEY) ?? '[]') as DroppedTable[]
  const checked = dropped.reduce((total, table) => total + table.rows, 0)
  const left = existingOldTables(db)
  const notes = dropped.map((table) => `dropped ${table.name} (${table.rows} rows)`)
  if (left.length > 0) notes.push(`still there: ${left.join(', ')}`)
  return { checked, resolved: checked, unresolved: 0, hasPassed: left.length === 0, notes }
}

export const dropOldSessionsJob: DataJob = {
  name: 'drop-old-sessions',
  version: 1,
  description: 'Remove the old session tables, now that their summaries are anchored',
  // Nothing to clear: the job drops tables, and a rerun drops what's left
  prepare: () => undefined,
  runBatch,
  verify,
}
