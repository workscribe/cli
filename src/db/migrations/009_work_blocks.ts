// Strictly additive. Everything here is derived from `events` and rebuilt per day (src/sessions/threads.ts), so the
// `project_id` columns carry no foreign key: a project merged or deleted later can't block a write, and the day's
// next rebuild replaces the rows.
const migration = {
  version: 9,
  description: 'Add work blocks, project threads and activity slots, built per day alongside sessions',
  sql: `
    CREATE TABLE IF NOT EXISTS work_block (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      date             TEXT    NOT NULL,
      started_at       TEXT    NOT NULL,
      ended_at         TEXT    NOT NULL,
      event_count      INTEGER NOT NULL,
      active_slots     INTEGER NOT NULL,
      grouping_version INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_work_block_date ON work_block (date, started_at);
    CREATE TABLE IF NOT EXISTS thread (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      block_id     INTEGER NOT NULL REFERENCES work_block (id) ON DELETE CASCADE,
      project_id   INTEGER,
      started_at   TEXT    NOT NULL,
      ended_at     TEXT    NOT NULL,
      event_count  INTEGER NOT NULL,
      active_slots INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_thread_block ON thread (block_id);
    CREATE INDEX IF NOT EXISTS idx_thread_project ON thread (project_id, started_at);
    CREATE TABLE IF NOT EXISTS thread_event (
      thread_id INTEGER NOT NULL REFERENCES thread (id) ON DELETE CASCADE,
      event_id  INTEGER NOT NULL REFERENCES events (id) ON DELETE CASCADE,
      PRIMARY KEY (thread_id, event_id)
    );
    CREATE INDEX IF NOT EXISTS idx_thread_event_event ON thread_event (event_id);
    CREATE TABLE IF NOT EXISTS activity_slot (
      date        TEXT    NOT NULL,
      slot_start  TEXT    NOT NULL,
      project_id  INTEGER,
      event_count INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_activity_slot_date ON activity_slot (date, slot_start);
    CREATE TABLE IF NOT EXISTS grouping_day (
      date             TEXT    PRIMARY KEY,
      grouping_version INTEGER NOT NULL,
      idle_ms          INTEGER NOT NULL,
      event_count      INTEGER NOT NULL,
      link_checksum    INTEGER NOT NULL,
      link_spread      INTEGER NOT NULL,
      max_event_id     INTEGER
    );
  `,
}

export default migration
