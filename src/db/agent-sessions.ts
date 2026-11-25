import type { MigrationDatabase } from './migration-types'

// `agent_sessions` (migration 012): the agent conversations hook events came from. `node:sqlite`-free, so tests run
// it on an in-memory database.

/** Which conversation an agent event came from: the agent, and the id it gives the conversation. */
export interface AgentSessionRef {
  source: string
  sessionId: string
}

// Hooks run async and stamp their own time, so a tool event Claude Code fired just before SessionEnd can still be
// stamped after it. Only an event this long after the end means the conversation was resumed — which takes a person
// relaunching it and prompting again.
const RESUMED_AFTER_SECONDS = 10
const SECONDS_PER_DAY = 86_400
// Fixed SQL, shared by both columns; the gap is bound as `$resumed_after_days`
const IS_RESUMED = 'julianday(excluded.last_seen_at) - julianday(ended_at) > $resumed_after_days'

/**
 * The session's id, creating it on first sight with the event's folder and time. After that only `last_seen_at`
 * moves, and only forward. An event well after the session ended means it was resumed, so it's no longer ended.
 */
export function upsertAgentSession(
  db: MigrationDatabase,
  session: AgentSessionRef & { cwd: string; capturedAt: string }
): number {
  const row = db
    .prepare(
      `INSERT INTO agent_sessions (source, session_id, cwd, started_at, last_seen_at)
       VALUES ($source, $session_id, $cwd, $captured_at, $captured_at)
       ON CONFLICT (source, session_id) DO UPDATE SET
         last_seen_at = MAX(last_seen_at, excluded.last_seen_at),
         ended_at = CASE WHEN ${IS_RESUMED} THEN NULL ELSE ended_at END,
         end_reason = CASE WHEN ${IS_RESUMED} THEN NULL ELSE end_reason END
       RETURNING id`
    )
    .get({
      source: session.source,
      session_id: session.sessionId,
      cwd: session.cwd,
      captured_at: session.capturedAt,
      resumed_after_days: RESUMED_AFTER_SECONDS / SECONDS_PER_DAY,
    }) as { id: number }
  return row.id
}

/**
 * Records that a session ended, and why. Only a session already seen through an event: a conversation that captured
 * nothing gets no row, so `undo` and `clear` never leave one behind.
 */
export function recordAgentSessionEnd(
  db: MigrationDatabase,
  session: AgentSessionRef & { endedAt: string; reason: string | null }
): void {
  db.prepare(
    `UPDATE agent_sessions SET ended_at = $ended_at, end_reason = $end_reason
     WHERE source = $source AND session_id = $session_id`
  ).run({
    source: session.source,
    session_id: session.sessionId,
    ended_at: session.endedAt,
    end_reason: session.reason,
  })
}

/** Which of the agent's own messages a session keeps: its latest recap, or its latest compaction summary. */
export type AgentMessageKind = 'recap' | 'compactSummary'

const MESSAGE_UPDATES: Record<AgentMessageKind, string> = {
  recap: 'UPDATE agent_sessions SET recap = $text WHERE source = $source AND session_id = $session_id',
  compactSummary:
    'UPDATE agent_sessions SET compact_summary = $text WHERE source = $source AND session_id = $session_id',
}

/** Stores the session's latest message of this kind, replacing the earlier one. Only a session already seen. */
export function recordAgentMessage(
  db: MigrationDatabase,
  message: AgentSessionRef & { kind: AgentMessageKind; text: string }
): void {
  db.prepare(MESSAGE_UPDATES[message.kind]).run({
    source: message.source,
    session_id: message.sessionId,
    text: message.text,
  })
}

/**
 * Forgets every stored recap and compaction summary, and the description kept of each command (`intent`, in its
 * event's metadata) — when the agent's words are no longer kept. Metadata that isn't JSON is left as it is.
 */
export function clearAgentMessages(db: MigrationDatabase): void {
  db.prepare('UPDATE agent_sessions SET recap = NULL, compact_summary = NULL').run()
  db.prepare(
    `UPDATE events SET metadata = json_remove(metadata, '$.intent')
     WHERE json_valid(metadata) AND json_extract(metadata, '$.intent') IS NOT NULL`
  ).run()
}

/** What `sessions --json` says about an agent session: never its working folder. */
export interface AgentSessionInfo {
  id: number
  source: string
  sessionId: string
  startedAt: string
  lastSeenAt: string
  endedAt: string | null
  /** The agent's latest recap; stored only with `capture.agentMessages`. Never in a contract unless asked for. */
  recap: string | null
}

/** The distinct agent sessions these events came from, oldest first. */
export function getAgentSessionsOfEvents(db: MigrationDatabase, eventIds: number[]): AgentSessionInfo[] {
  return db
    .prepare(
      `SELECT id, source, session_id AS sessionId, started_at AS startedAt, last_seen_at AS lastSeenAt,
              ended_at AS endedAt, recap FROM agent_sessions
       WHERE id IN (SELECT agent_session_id FROM events WHERE id IN (SELECT value FROM json_each(?)))
       ORDER BY started_at, id`
    )
    .all(JSON.stringify(eventIds)) as unknown as AgentSessionInfo[]
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
