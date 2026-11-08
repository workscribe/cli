// Strictly additive. How an agent session ended (`SessionEnd`'s reason; `ended_at` is from migration 012), and, only
// when `capture.agentMessages` is on, the agent's latest recap and compaction summary — redacted and capped (WOR-136).
const migration = {
  version: 14,
  description: 'Add how an agent session ended, and its opt-in recap and compaction summary',
  sql: `
    ALTER TABLE agent_sessions ADD COLUMN end_reason TEXT;
    ALTER TABLE agent_sessions ADD COLUMN recap TEXT;
    ALTER TABLE agent_sessions ADD COLUMN compact_summary TEXT;
  `,
}

export default migration
