import type { MigrationDatabase } from '../migration-types'
import type { BatchResult, DataJob, JobVerification } from './types'
import { isReadOnlyCommand, READ_ONLY_CATEGORY, readOnlyMetadata } from '../../normalize/read-only'

// Moves stored commands that only read to `exploring`, so past days read like new ones (WOR-156). It only moves rows
// into `exploring`: an old `grep x && ./deploy.sh` stays where it is. Grouping doesn't read `category`, so threads
// don't need rebuilding. Bump the version when the read-only list widens.

const JOB_NAME = 'read-only-commands'
const VERIFY_PAGE_SIZE = 500
// Where the rules used to put these commands: `git log` in versioning, `ls` in other, older rows' `sed -n` in files and
// `python3 -c` in running
const MOVABLE_CATEGORIES = ['versioning', 'other', 'files', 'running']
const CATEGORY_PLACEHOLDERS = MOVABLE_CATEGORIES.map(() => '?').join(', ')

interface StoredEvent {
  id: number
  command: string
  metadata: string | null
}

function parsedObject(metadata: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(metadata)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * A moved row's metadata: what a new capture would store, without the `hint` or `tool` that described it before, and
 * with whatever else it holds. Metadata that can't be read is left as it is.
 */
export function movedMetadata({ command, metadata }: Pick<StoredEvent, 'command' | 'metadata'>): string {
  if (metadata === null) return JSON.stringify(readOnlyMetadata(command))
  const parsed = parsedObject(metadata)
  if (parsed === null) return metadata
  const { hint: _hint, tool: _tool, ...kept } = parsed
  return JSON.stringify({ ...kept, ...readOnlyMetadata(command) })
}

function readCandidates(db: MigrationDatabase, afterId: number, limit: number): StoredEvent[] {
  return db
    .prepare(
      `SELECT id, command, metadata FROM events
       WHERE id > ? AND category IN (${CATEGORY_PLACEHOLDERS})
       ORDER BY id LIMIT ?`
    )
    .all(afterId, ...MOVABLE_CATEGORIES, limit) as unknown as StoredEvent[]
}

function runBatch(db: MigrationDatabase, afterId: number, limit: number): BatchResult {
  const events = readCandidates(db, afterId, limit)
  if (events.length === 0) return { lastId: null, issues: [] }
  const update = db.prepare('UPDATE events SET category = ?, metadata = ? WHERE id = ?')
  for (const event of events) {
    if (isReadOnlyCommand(event.command)) update.run(READ_ONLY_CATEGORY, movedMetadata(event), event.id)
  }
  return { lastId: events[events.length - 1].id, issues: [] }
}

/** Nothing is removed, so a row left behind can't fail the check: the count is for `status`. */
function verify(db: MigrationDatabase): JobVerification {
  let checked = 0
  let unresolved = 0
  let afterId = 0
  for (;;) {
    const events = readCandidates(db, afterId, VERIFY_PAGE_SIZE)
    if (events.length === 0) break
    checked += events.length
    unresolved += events.filter((event) => isReadOnlyCommand(event.command)).length
    afterId = events[events.length - 1].id
  }
  const notes = unresolved > 0 ? [`read-only events not moved: ${unresolved}`] : []
  return { checked, resolved: checked - unresolved, unresolved, hasPassed: true, notes }
}

export const readOnlyCommandsJob: DataJob = {
  name: JOB_NAME,
  version: 1,
  description: 'Move stored read-only commands out of summaries',
  // Moved rows are simply not candidates any more, so a rerun has nothing to clear first
  prepare: () => undefined,
  runBatch,
  verify,
}
