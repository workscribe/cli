// Strictly additive, like every migration from here on: data work belongs in a data job (src/db/jobs/), which is
// batched, resumable and backed up, never in a migration that runs in whichever process opens the database first.
const migration = {
  version: 7,
  description: 'Add data job state, the issues jobs record, and a meta key-value table',
  sql: `
    CREATE TABLE IF NOT EXISTS data_jobs (
      name         TEXT    PRIMARY KEY,
      version      INTEGER NOT NULL,
      cursor       INTEGER NOT NULL DEFAULT 0,
      status       TEXT    NOT NULL DEFAULT 'pending',
      started_at   TEXT,
      finished_at  TEXT,
      verification TEXT,
      error        TEXT
    );
    CREATE TABLE IF NOT EXISTS data_job_issues (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      job_name    TEXT    NOT NULL,
      job_version INTEGER NOT NULL,
      reference   TEXT    NOT NULL,
      reason      TEXT    NOT NULL,
      recorded_at TEXT    NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_data_job_issues_job ON data_job_issues (job_name, job_version);
    CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `,
}

export default migration
