// Strictly additive: the tables and the two nullable `events` columns start empty. Capture fills them for new events
// and the `project-dimensions` data job (src/db/jobs/project-dimensions.ts) fills them for the history.
const migration = {
  version: 8,
  description: 'Add project, branch and file dimensions, and link events to them',
  sql: `
    CREATE TABLE IF NOT EXISTS project (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      identity TEXT    NOT NULL UNIQUE,
      kind     TEXT    NOT NULL,
      name     TEXT
    );
    CREATE TABLE IF NOT EXISTS project_alias (
      project_id INTEGER NOT NULL REFERENCES project (id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      PRIMARY KEY (project_id, name)
    );
    CREATE INDEX IF NOT EXISTS idx_project_alias_name ON project_alias (name);
    CREATE TABLE IF NOT EXISTS project_path (
      project_id INTEGER NOT NULL REFERENCES project (id) ON DELETE CASCADE,
      path       TEXT    NOT NULL,
      PRIMARY KEY (project_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_project_path_path ON project_path (path);
    CREATE TABLE IF NOT EXISTS branch (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES project (id) ON DELETE CASCADE,
      name       TEXT    NOT NULL,
      UNIQUE (project_id, name)
    );
    CREATE TABLE IF NOT EXISTS file (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id    INTEGER NOT NULL REFERENCES project (id) ON DELETE CASCADE,
      relative_path TEXT    NOT NULL,
      UNIQUE (project_id, relative_path)
    );
    CREATE TABLE IF NOT EXISTS event_file (
      event_id INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
      file_id  INTEGER NOT NULL REFERENCES file (id) ON DELETE CASCADE,
      action   TEXT    NOT NULL,
      PRIMARY KEY (event_id, file_id)
    );
    CREATE INDEX IF NOT EXISTS idx_event_file_file ON event_file (file_id);
    CREATE TABLE IF NOT EXISTS directory_probe (
      path       TEXT PRIMARY KEY,
      outcome    TEXT NOT NULL,
      root       TEXT,
      common_dir TEXT,
      remote_url TEXT
    );
    CREATE TABLE IF NOT EXISTS project_resolution (
      cwd         TEXT    NOT NULL,
      repo_name   TEXT    NOT NULL,
      project_id  INTEGER REFERENCES project (id) ON DELETE CASCADE,
      method      TEXT    NOT NULL,
      event_count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (cwd, repo_name)
    );
    ALTER TABLE events ADD COLUMN project_id INTEGER REFERENCES project (id);
    ALTER TABLE events ADD COLUMN branch_id INTEGER REFERENCES branch (id);
    CREATE INDEX IF NOT EXISTS idx_events_project_id ON events (project_id);
    CREATE INDEX IF NOT EXISTS idx_events_branch_id ON events (branch_id);
  `,
}

export default migration
