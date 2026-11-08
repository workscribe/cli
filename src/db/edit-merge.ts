// Repeated edits of a file add up on one event instead of being dropped. `node:sqlite`-free, so tests run it on an
// in-memory database.
import type { MigrationDatabase } from './migration-types'
import { withImmediateTransaction } from './transaction'
import { upsertAgentSession, type AgentSessionRef } from './agent-sessions'
import { mergedEditMetadata, type EditCounts } from '../capture/edit-counts'

const CODE_EDIT = 'code_edit'

export interface RecentEdit {
  filePath: string
  cwd: string
  /** Who made the edit; edits from different sources never merge. Null matches null */
  source: string | null
  /** The agent conversation the edit was made in; edits from different conversations never merge */
  agentSession?: AgentSessionRef
  counts: EditCounts
  editedAt: string
  windowMs: number
}

interface LatestFileEvent {
  id: number
  capturedAt: string
  category: string
  source: string | null
  metadata: string | null
  agentSessionId: number | null
}

/**
 * The row id of the edit's agent session, or null with none — and null when the session has no row yet, which no event
 * can carry, so such an edit never merges.
 */
function agentSessionRowId(db: MigrationDatabase, agentSession: AgentSessionRef | undefined): number | null {
  if (!agentSession) return null
  const row = db
    .prepare('SELECT id FROM agent_sessions WHERE source = ? AND session_id = ?')
    .get(agentSession.source, agentSession.sessionId) as { id: number } | undefined
  return row?.id ?? null
}

function isSameAgentSession(db: MigrationDatabase, latest: LatestFileEvent, edit: RecentEdit): boolean {
  if (!edit.agentSession) return latest.agentSessionId === null
  const sessionId = agentSessionRowId(db, edit.agentSession)
  return sessionId !== null && latest.agentSessionId === sessionId
}

function isMergeable(
  db: MigrationDatabase,
  latest: LatestFileEvent | undefined,
  edit: RecentEdit
): latest is LatestFileEvent {
  if (!latest || latest.category !== CODE_EDIT || latest.source !== edit.source) return false
  if (!isSameAgentSession(db, latest, edit)) return false
  // Measured from the event's own time, never its last edit, so a long run of edits is one event per window
  return new Date(edit.editedAt).getTime() - new Date(latest.capturedAt).getTime() < edit.windowMs
}

/**
 * Adds the edit to the file's latest event when that's an edit from the same source and agent session within the
 * window, keeping the event's time — threads are only rebuilt when the event count changes, so moving it would leave
 * them stale. Finding and updating hold the write lock, so two edits captured at once both count. False when there was
 * nothing to merge into: the caller stores the edit as a new event.
 */
export function mergeIntoRecentEdit(db: MigrationDatabase, edit: RecentEdit): boolean {
  return withImmediateTransaction(db, () => {
    // The latest event of any category, as the per-file de-duplication always read it
    const latest = db
      .prepare(
        `SELECT id, captured_at AS capturedAt, category, source, metadata, agent_session_id AS agentSessionId
         FROM events WHERE file_path = ? AND cwd = ? ORDER BY id DESC LIMIT 1`
      )
      .get(edit.filePath, edit.cwd) as LatestFileEvent | undefined
    if (!isMergeable(db, latest, edit)) return false
    db.prepare('UPDATE events SET metadata = ? WHERE id = ?').run(
      mergedEditMetadata(latest.metadata, edit.counts, edit.editedAt),
      latest.id
    )
    // The session saw this edit, as an insert would have told it
    if (edit.agentSession) upsertAgentSession(db, { ...edit.agentSession, cwd: edit.cwd, capturedAt: edit.editedAt })
    return true
  })
}
