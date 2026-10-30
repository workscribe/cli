import type { MigrationDatabase } from './migration-types'
import { isDatabaseLocked, withImmediateTransaction } from './transaction'
import { writeEventDimensions, type EventDimensions } from './dimensions'
import { debugLog } from '../utils/logger'

export interface NewEvent {
  captured_at: string
  command: string
  cwd: string
  exit_code: number | null
  duration_ms: number | null
  repo_name: string | null
  branch: string | null
  category: string
  metadata: string | null
  source: string | null
  file_path: string | null
  /** What the event links to. The text columns above are stored exactly as given either way */
  dimensions?: EventDimensions
}

function insertEventRow(db: MigrationDatabase, event: NewEvent): number {
  const { dimensions: _dimensions, ...columns } = event
  const result = db
    .prepare(
      `INSERT INTO events (captured_at, command, cwd, exit_code, duration_ms, repo_name, branch, category, metadata, source, file_path)
       VALUES ($captured_at, $command, $cwd, $exit_code, $duration_ms, $repo_name, $branch, $category, $metadata, $source, $file_path)`
    )
    .run(columns) as { lastInsertRowid: number | bigint }
  return Number(result.lastInsertRowid)
}

/**
 * Stores an event and its links in one transaction. If linking fails, the event is stored without links rather
 * than lost. A lock that never came free is thrown, as a plain insert would have been: no second wait.
 */
export function insertEventRecord(db: MigrationDatabase, event: NewEvent): void {
  const dimensions = event.dimensions
  if (!dimensions?.project) {
    insertEventRow(db, event)
    return
  }
  try {
    withImmediateTransaction(db, () => writeEventDimensions(db, insertEventRow(db, event), dimensions))
  } catch (error) {
    if (isDatabaseLocked(error)) throw error
    debugLog('capture: linking the event to its project', error)
    insertEventRow(db, event)
  }
}
