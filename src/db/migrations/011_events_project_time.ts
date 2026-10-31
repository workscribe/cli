// Strictly additive: an index, so `context` finds a project's latest event without sorting all of them.
const migration = {
  version: 11,
  description: "Index events by project and time, for a project's latest event",
  sql: `
    CREATE INDEX IF NOT EXISTS idx_events_project_time ON events (project_id, captured_at);
  `,
}

export default migration
