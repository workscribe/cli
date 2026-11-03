import type { MigrationDatabase } from './migration-types'

// `agent_sessions` (migration 012): the agent conversations hook events came from. `node:sqlite`-free, so tests run
// it on an in-memory database.

/** Which conversation an agent event came from: the agent, and the id it gives the conversation. */
export interface AgentSessionRef {
  source: string
  sessionId: string
}

/**
 * The session's id, creating it on first sight with the event's folder and time. After that only `last_seen_at`
 * moves, and only forward.
 */
export function upsertAgentSession(
  db: MigrationDatabase,
  session: AgentSessionRef & { cwd: string; capturedAt: string }
): number {
  const row = db
    .prepare(
      `INSERT INTO agent_sessions (source, session_id, cwd, started_at, last_seen_at)
       VALUES ($source, $session_id, $cwd, $captured_at, $captured_at)
       ON CONFLICT (source, session_id) DO UPDATE SET last_seen_at = MAX(last_seen_at, excluded.last_seen_at)
       RETURNING id`
    )
    .get({
      source: session.source,
      session_id: session.sessionId,
      cwd: session.cwd,
      captured_at: session.capturedAt,
    }) as { id: number }
  return row.id
}

/** The agent sessions these events belong to — read before deleting them. */
export function agentSessionIdsOfEvents(db: MigrationDatabase, eventIds: number[]): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT agent_session_id AS id FROM events
       WHERE id IN (SELECT value FROM json_each(?)) AND agent_session_id IS NOT NULL`
    )
    .all(JSON.stringify(eventIds)) as { id: number }[]
  return rows.map((row) => row.id)
}

/** The agent sessions of a local day's events — read before `clear` deletes them. */
export function agentSessionIdsOfDate(db: MigrationDatabase, date: string): number[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT agent_session_id AS id FROM events
       WHERE date(captured_at, 'localtime') = ? AND agent_session_id IS NOT NULL`
    )
    .all(date) as { id: number }[]
  return rows.map((row) => row.id)
}

/**
 * Deletes those of these sessions no event belongs to any more — after their events were deleted, so `undo` and
 * `clear` leave no conversation id behind. Only these: a session recorded with no event yet is never touched.
 */
export function deleteEmptyAgentSessions(db: MigrationDatabase, sessionIds: number[]): void {
  if (sessionIds.length === 0) return
  db.prepare(
    `DELETE FROM agent_sessions
     WHERE id IN (SELECT value FROM json_each(?))
       AND NOT EXISTS (SELECT 1 FROM events WHERE events.agent_session_id = agent_sessions.id)`
  ).run(JSON.stringify(sessionIds))
}
