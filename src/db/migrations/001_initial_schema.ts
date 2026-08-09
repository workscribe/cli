export default {
  version: 1,
  description: 'initial schema',
  sql: `
    CREATE TABLE IF NOT EXISTS events (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at TEXT    NOT NULL,
      command     TEXT    NOT NULL,
      cwd         TEXT    NOT NULL,
      exit_code   INTEGER,
      duration_ms INTEGER,
      repo_name   TEXT,
      branch      TEXT,
      category    TEXT    NOT NULL DEFAULT 'other',
      metadata    TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_events_captured_at ON events(captured_at);
    CREATE INDEX IF NOT EXISTS idx_events_repo_name   ON events(repo_name);

    CREATE TABLE IF NOT EXISTS sessions (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT    NOT NULL,
      started_at  TEXT    NOT NULL,
      ended_at    TEXT    NOT NULL,
      repo_name   TEXT,
      event_count INTEGER NOT NULL DEFAULT 0,
      summary     TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);

    CREATE TABLE IF NOT EXISTS session_events (
      session_id  INTEGER NOT NULL REFERENCES sessions(id),
      event_id    INTEGER NOT NULL REFERENCES events(id),
      PRIMARY KEY (session_id, event_id)
    );
  `,
}
