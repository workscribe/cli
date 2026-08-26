const migration = {
  version: 3,
  description: 'Add alerts table for AI session secret detection',
  sql: `
    CREATE TABLE IF NOT EXISTS alerts (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER NOT NULL,
      tool       TEXT    NOT NULL,
      session_id TEXT,
      context    TEXT    NOT NULL,
      cleared    INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS alerts_cleared ON alerts (cleared);
  `,
}

export default migration
