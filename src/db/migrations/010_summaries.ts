// Strictly additive. A summary is kept against the events it describes rather than a derived session id or key, so
// regrouping never orphans it. No foreign keys: a summary is never deleted because its events or project went away.
const migration = {
  version: 10,
  description: 'Add summaries anchored to the events they describe',
  sql: `
    CREATE TABLE IF NOT EXISTS summary (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      scope          TEXT    NOT NULL,
      project_id     INTEGER,
      first_event_id INTEGER,
      last_event_id  INTEGER,
      engine         TEXT    NOT NULL,
      text           TEXT    NOT NULL,
      created_at     TEXT    NOT NULL,
      source_key     TEXT,
      origin         TEXT    NOT NULL,
      anchor_source  TEXT    NOT NULL,
      is_mixed       INTEGER NOT NULL DEFAULT 0
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_summary_source ON summary (source_key, engine);
    CREATE INDEX IF NOT EXISTS idx_summary_first_event ON summary (first_event_id);
  `,
}

export default migration
