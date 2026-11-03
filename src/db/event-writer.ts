import type { MigrationDatabase } from './migration-types'
import { isDatabaseLocked, withImmediateTransaction } from './transaction'
import { writeEventDimensions, type EventDimensions } from './dimensions'
import { upsertAgentSession, type AgentSessionRef } from './agent-sessions'
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
  /** The agent conversation a hook event came from */
  agentSession?: AgentSessionRef
}

function insertEventRow(db: MigrationDatabase, event: NewEvent, agentSessionId: number | null = null): number {
  const { dimensions: _dimensions, agentSession: _agentSession, ...columns } = event
  const result = db
    .prepare(
      `INSERT INTO events (captured_at, command, cwd, exit_code, duration_ms, repo_name, branch, category, metadata, source, file_path, agent_session_id)
       VALUES ($captured_at, $command, $cwd, $exit_code, $duration_ms, $repo_name, $branch, $category, $metadata, $source, $file_path, $agent_session_id)`
    )
    .run({ ...columns, agent_session_id: agentSessionId }) as { lastInsertRowid: number | bigint }
  return Number(result.lastInsertRowid)
}

/** The event, its agent session and its project links, written in order inside the caller's transaction. */
function insertLinkedEvent(db: MigrationDatabase, event: NewEvent): void {
  const agentSessionId = event.agentSession
    ? upsertAgentSession(db, { ...event.agentSession, cwd: event.cwd, capturedAt: event.captured_at })
    : null
  const eventId = insertEventRow(db, event, agentSessionId)
  if (event.dimensions?.project) writeEventDimensions(db, eventId, event.dimensions)
}

/**
 * Stores an event and its links — its project and its agent session — in one transaction. If linking fails, the
 * event is stored without links rather than lost. A lock that never came free is thrown, as a plain insert would
 * have been: no second wait. An event with nothing to link is one plain insert.
 */
export function insertEventRecord(db: MigrationDatabase, event: NewEvent): void {
  if (!event.dimensions?.project && !event.agentSession) {
    insertEventRow(db, event)
    return
  }
  try {
    withImmediateTransaction(db, () => insertLinkedEvent(db, event))
  } catch (error) {
    if (isDatabaseLocked(error)) throw error
    debugLog('capture: linking the event', error)
    insertEventRow(db, event)
  }
}
