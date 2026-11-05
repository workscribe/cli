import type { MigrationDatabase } from './migration-types'

// The `ticket` and `ticket_ref` rows (migration 013). Insert-or-ignore throughout, so capture and the `ticket-refs`
// job can both write them, in any order, any number of times. `node:sqlite`-free, so tests run it in memory.

/** Ticket keys an event names: in its linked branch's name, and in the commits it made. */
export interface TicketKeys {
  branch: string[]
  commits: string[]
}

function upsertTicket(db: MigrationDatabase, key: string): number {
  db.prepare('INSERT OR IGNORE INTO ticket (key) VALUES (?)').run(key)
  return (db.prepare('SELECT id FROM ticket WHERE key = ?').get(key) as { id: number }).id
}

/**
 * Links the keys to the event's branch and to the event itself. Branch keys need the branch the event is linked to:
 * without one (outside a project, or a save in another repo), they link nothing.
 */
export function linkEventTickets(
  db: MigrationDatabase,
  link: { eventId: number; branchId: number | null; keys: TicketKeys }
): void {
  if (link.branchId !== null) {
    const linkBranch = db.prepare('INSERT OR IGNORE INTO ticket_ref (ticket_id, branch_id) VALUES (?, ?)')
    for (const key of link.keys.branch) linkBranch.run(upsertTicket(db, key), link.branchId)
  }
  const linkEvent = db.prepare('INSERT OR IGNORE INTO ticket_ref (ticket_id, event_id) VALUES (?, ?)')
  for (const key of link.keys.commits) linkEvent.run(upsertTicket(db, key), link.eventId)
}

/** The keys linked to these events, or to the branches they're on — sorted numerically (WOR-9 before WOR-10). */
export function ticketsOfEvents(db: MigrationDatabase, eventIds: number[]): string[] {
  const rows = db
    .prepare(
      `WITH chosen AS (SELECT value AS id FROM json_each(?))
       SELECT DISTINCT ticket.key FROM ticket_ref JOIN ticket ON ticket.id = ticket_ref.ticket_id
       WHERE ticket_ref.event_id IN (SELECT id FROM chosen)
          OR ticket_ref.branch_id IN (SELECT branch_id FROM events WHERE id IN (SELECT id FROM chosen))`
    )
    .all(JSON.stringify(eventIds)) as { key: string }[]
  return rows.map((row) => row.key).sort((first, second) => first.localeCompare(second, 'en', { numeric: true }))
}
