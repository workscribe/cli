// Strictly additive. The agent conversation each hook event came from (Claude Code's `session_id`), so one agent's
// work across several repos can be linked. WOR-136 extends this table with how a session ended and its recaps.
const migration = {
  version: 12,
  description: 'Add agent sessions, and link each agent event to its session',
  sql: `
    CREATE TABLE IF NOT EXISTS agent_sessions (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      source       TEXT    NOT NULL,
      session_id   TEXT    NOT NULL,
      cwd          TEXT,
      started_at   TEXT    NOT NULL,
      ended_at     TEXT,
      last_seen_at TEXT    NOT NULL,
      UNIQUE (source, session_id)
    );
    ALTER TABLE events ADD COLUMN agent_session_id INTEGER REFERENCES agent_sessions (id);
    CREATE INDEX IF NOT EXISTS idx_events_agent_session ON events (agent_session_id);
  `,
}

export default migration
