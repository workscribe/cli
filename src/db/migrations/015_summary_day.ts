// Strictly additive. The local day a summary describes (WOR-179), so it can still be found after the events it
// described are removed: its key names its thread's start, but that is read from the text of the key, never from an
// index. The `summary-days` job fills it for the summaries already stored; saves write it from now on.
const migration = {
  version: 15,
  description: 'Add the day a summary describes',
  sql: `
    ALTER TABLE summary ADD COLUMN day TEXT;
    CREATE INDEX IF NOT EXISTS idx_summary_day ON summary (day);
  `,
}

export default migration
