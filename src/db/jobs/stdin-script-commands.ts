import type { MigrationDatabase } from '../migration-types'
import type { BatchResult, DataJob, JobVerification } from './types'
import { normalizeCommand } from '../../normalize/patterns'
import { stdinScriptCount } from '../../normalize/stdin-scripts'

// Moves stored `python3 - <<EOF` commands out of `exploring` (WOR-215). A script read from standard input was taken for
// code that only prints, so it was filed as a read, and a script that rewrote files vanished from the story and from
// `sessions --json`. Each row is read the way a new capture reads it, and moves only when that is no longer
// `exploring`: it never touches another category, the stored command or the exit code. Only `python` and `python3`
// with `-` were ever read-only, so nothing else is a candidate. Grouping doesn't read `category`, so threads don't need
// rebuilding. Bump the version when more scripts are told apart.

const JOB_NAME = 'stdin-script-commands'
const VERIFY_PAGE_SIZE = 500
const EXPLORING = 'exploring'

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
  const { tool: _tool, subcommand: _subcommand, ...kept } = parsed
  return JSON.stringify({ ...kept, ...metadata })
}

function readCandidates(db: MigrationDatabase, afterId: number, limit: number): StoredEvent[] {
  return db
    .prepare(
      `SELECT id, command, metadata FROM events
       WHERE id > ? AND category = ? AND command LIKE '%python%'
       ORDER BY id LIMIT ?`
    )
    .all(afterId, EXPLORING, limit) as unknown as StoredEvent[]
}

function isMovable(event: StoredEvent): boolean {
  return stdinScriptCount(event.command) > 0 && normalizeCommand(event.command).category !== EXPLORING
}

function runBatch(db: MigrationDatabase, afterId: number, limit: number): BatchResult {
  const events = readCandidates(db, afterId, limit)
  if (events.length === 0) return { lastId: null, issues: [] }
  const update = db.prepare('UPDATE events SET category = ?, metadata = ? WHERE id = ?')
  for (const event of events) {
    if (stdinScriptCount(event.command) === 0) continue
    const { category, metadata } = normalizeCommand(event.command)
    if (category !== EXPLORING) update.run(category, movedMetadata(event.metadata, metadata), event.id)
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
  const notes = unresolved > 0 ? [`script commands not moved: ${unresolved}`] : []
  return { checked, resolved: checked - unresolved, unresolved, hasPassed: true, notes }
}

export const stdinScriptCommandsJob: DataJob = {
  name: JOB_NAME,
  version: 1,
  description: 'Move stored scripts read from standard input out of exploring',
  // Moved rows are simply not candidates any more, so a rerun has nothing to clear first
  prepare: () => undefined,
  runBatch,
  verify,
}
