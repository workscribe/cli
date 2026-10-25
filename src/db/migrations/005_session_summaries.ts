// Must produce exactly what sessionKey() in src/summary/store.ts produces — pinned by a test.
export const SESSION_KEY_SQL = "COALESCE(repo_name, '') || '|' || started_at"

const migration = {
  version: 5,
  description: 'Store session summaries per engine, keyed by repo and start time so they survive session rebuilds',
  sql: `
    CREATE TABLE IF NOT EXISTS session_summaries (
      session_key TEXT NOT NULL,
      engine      TEXT NOT NULL,
      text        TEXT NOT NULL,
      created_at  TEXT NOT NULL,
      PRIMARY KEY (session_key, engine)
    );
    INSERT OR IGNORE INTO session_summaries (session_key, engine, text, created_at)
      SELECT ${SESSION_KEY_SQL}, 'legacy', summary, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      FROM sessions
      WHERE summary IS NOT NULL;
  `,
}

export default migration
