// Strictly additive. Tickets named by branches and commit messages (WOR-144): a ticket links to a branch, or to the
// commit event that named it. Capture fills them for new events and the `ticket-refs` data job for the history; an
// event's links go with it (undo, clear) and a branch's with the branch.
const migration = {
  version: 13,
  description: 'Add tickets, linked to the branches and commits that name them',
  sql: `
    CREATE TABLE IF NOT EXISTS ticket (
      id  INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT    NOT NULL UNIQUE
    );
    CREATE TABLE IF NOT EXISTS ticket_ref (
      ticket_id INTEGER NOT NULL REFERENCES ticket (id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branch (id) ON DELETE CASCADE,
      event_id  INTEGER REFERENCES events (id) ON DELETE CASCADE,
      CHECK ((branch_id IS NULL) <> (event_id IS NULL))
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_ref_branch ON ticket_ref (branch_id, ticket_id) WHERE branch_id IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ticket_ref_event ON ticket_ref (event_id, ticket_id) WHERE event_id IS NOT NULL;
  `,
}

export default migration
