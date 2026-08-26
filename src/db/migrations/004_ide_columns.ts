const migration = {
  version: 4,
  description: 'Add source and file_path columns to events for IDE integration',
  sql: `
    ALTER TABLE events ADD COLUMN source TEXT;
    ALTER TABLE events ADD COLUMN file_path TEXT;
    CREATE INDEX IF NOT EXISTS idx_events_file_path ON events (file_path, cwd);
  `,
}

export default migration
