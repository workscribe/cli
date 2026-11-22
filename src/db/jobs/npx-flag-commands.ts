import type { MigrationDatabase } from '../migration-types'
import type { BatchResult, DataJob, JobVerification } from './types'
import { normalizeCommand } from '../../normalize/patterns'

// Moves stored `npx <flag> <tool>` commands out of `running` (WOR-174). Before, `npx --no-install eslint` took the flag
// for the tool and was stored as `running`, so past days miss their test, lint and type-check runs. Each row is read
// the way a new capture reads it, and moves only when that is no longer `running`: it never touches another category,
// the stored command or the exit code. Grouping doesn't read `category`, so threads don't need rebuilding. Bump the
// version when npx's flags are read differently.

const JOB_NAME = 'npx-flag-commands'
const VERIFY_PAGE_SIZE = 500
const RUNNING = 'running'
// `npx` followed by a flag, anywhere in the stored command
const NPX_WITH_FLAG = /\bnpx\s+-/

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

/** A moved row's metadata: what a new capture would store, over whatever else the row holds. Unreadable stays as is. */
function movedMetadata(stored: string | null, metadata: Record<string, unknown>): string | null {
  if (stored === null) return JSON.stringify(metadata)
  const parsed = parsedObject(stored)
  if (parsed === null) return stored
  const { tool: _tool, ...kept } = parsed
  return JSON.stringify({ ...kept, ...metadata })
}

function readCandidates(db: MigrationDatabase, afterId: number, limit: number): StoredEvent[] {
  return db
    .prepare(
      `SELECT id, command, metadata FROM events
       WHERE id > ? AND category = ? AND command LIKE '%npx%'
       ORDER BY id LIMIT ?`
    )
    .all(afterId, RUNNING, limit) as unknown as StoredEvent[]
}

function isMovable(event: StoredEvent): boolean {
  return NPX_WITH_FLAG.test(event.command) && normalizeCommand(event.command).category !== RUNNING
}

function runBatch(db: MigrationDatabase, afterId: number, limit: number): BatchResult {
  const events = readCandidates(db, afterId, limit)
  if (events.length === 0) return { lastId: null, issues: [] }
  const update = db.prepare('UPDATE events SET category = ?, metadata = ? WHERE id = ?')
  for (const event of events) {
    if (!NPX_WITH_FLAG.test(event.command)) continue
    const { category, metadata } = normalizeCommand(event.command)
    if (category !== RUNNING) update.run(category, movedMetadata(event.metadata, metadata), event.id)
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
    unresolved += events.filter(isMovable).length
    afterId = events[events.length - 1].id
  }
  const notes = unresolved > 0 ? [`npx commands not moved: ${unresolved}`] : []
  return { checked, resolved: checked - unresolved, unresolved, hasPassed: true, notes }
}

export const npxFlagCommandsJob: DataJob = {
  name: JOB_NAME,
  version: 1,
  description: 'Move stored npx commands with flags out of running',
  // Moved rows are simply not candidates any more, so a rerun has nothing to clear first
  prepare: () => undefined,
  runBatch,
  verify,
}
