import type { MigrationDatabase } from './migration-types'
import { agentSessionIdsOfEvents, deleteEmptyAgentSessions } from './agent-sessions'

// The old sessions' links to events (migration 001), until the drop-old-sessions data job removes them: their foreign
// key would refuse to delete an event they point at, so every delete of events removes those links first
export const OLD_SESSION_LINKS = 'session_events'

export function hasOldSessionLinks(db: MigrationDatabase): boolean {
  return (
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(OLD_SESSION_LINKS) !== undefined
  )
}

/**
 * Deletes events by id, with what hangs off them: the old session links, then the events (their file, thread and
 * ticket links go with them by cascade), then the agent sessions they leave empty. Call it inside a transaction, so
 * `undo` and the removal of old data (WOR-179) share one rule for what an event takes with it. `node:sqlite`-free.
 */
export function deleteEventRows(db: MigrationDatabase, ids: number[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(', ')
  const agentSessionIds = agentSessionIdsOfEvents(db, ids)
  if (hasOldSessionLinks(db)) {
    db.prepare(`DELETE FROM ${OLD_SESSION_LINKS} WHERE event_id IN (${placeholders})`).run(...ids)
  }
  db.prepare(`DELETE FROM events WHERE id IN (${placeholders})`).run(...ids)
  deleteEmptyAgentSessions(db, agentSessionIds)
}
