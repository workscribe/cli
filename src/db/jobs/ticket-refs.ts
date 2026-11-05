import type { MigrationDatabase } from '../migration-types'
import type { BatchResult, DataJob, JobVerification } from './types'
import { getMetaValue, setMetaValue } from './store'
import { withImmediateTransaction } from '../transaction'
import { linkEventTickets } from '../tickets'
import { ticketKeysOf, ticketPatternOf } from '../../capture/tickets'
import type { EventRow } from '../types'

// Links the history's events to the tickets their branch names and commit messages name (WOR-144), as capture does
// for new events. It reads the pattern stored by `config set tickets.pattern`, never the live config, so a rerun
// derives the same links; changing the pattern through `config set` reruns it from `prepare`.

export const TICKET_REFS_JOB_NAME = 'ticket-refs'
const PATTERN_KEY = 'tickets:pattern'

type EventToLink = Pick<EventRow, 'id' | 'category' | 'metadata' | 'exit_code' | 'captured_at' | 'branch'> & {
  branch_id: number | null
  linked_branch: string | null
}

function runBatch(db: MigrationDatabase, afterId: number, limit: number): BatchResult {
  const events = db
    .prepare(
      `SELECT events.id, events.category, events.metadata, events.exit_code, events.captured_at, events.branch,
              events.branch_id, branch.name AS linked_branch
       FROM events LEFT JOIN branch ON branch.id = events.branch_id
       WHERE events.id > ? AND events.project_id IS NOT NULL
       ORDER BY events.id LIMIT ?`
    )
    .all(afterId, limit) as EventToLink[]
  if (events.length === 0) return { lastId: null, issues: [] }
  const pattern = ticketPatternOf(getMetaValue(db, PATTERN_KEY) ?? undefined)
  for (const event of events) {
    const keys = ticketKeysOf({ linkedBranch: event.linked_branch, event }, pattern)
    linkEventTickets(db, { eventId: event.id, branchId: event.branch_id, keys })
  }
  return { lastId: events[events.length - 1].id, issues: [] }
}

function countOf(db: MigrationDatabase, sql: string): number {
  return (db.prepare(sql).get() as { count: number }).count
}

/** Links are derived from the events, so none can go missing: the counts are for `status` and `upgrade`. */
function verify(db: MigrationDatabase): JobVerification {
  const checked = countOf(db, 'SELECT COUNT(*) AS count FROM events WHERE project_id IS NOT NULL')
  const tickets = countOf(db, 'SELECT COUNT(*) AS count FROM ticket')
  const branchLinks = countOf(db, 'SELECT COUNT(*) AS count FROM ticket_ref WHERE branch_id IS NOT NULL')
  const commitLinks = countOf(db, 'SELECT COUNT(*) AS count FROM ticket_ref WHERE event_id IS NOT NULL')
  return {
    checked,
    resolved: checked,
    unresolved: 0,
    hasPassed: true,
    notes: [`tickets: ${tickets}; branch links: ${branchLinks}; commit links: ${commitLinks}`],
  }
}

/**
 * Stores the pattern the history is linked with and restarts the job, so the next data command relinks every event
 * from `prepare`. One transaction: the pattern and the restart never disagree.
 */
export function requestTicketRelink(db: MigrationDatabase, pattern: string): void {
  withImmediateTransaction(db, () => {
    setMetaValue(db, PATTERN_KEY, pattern)
    db.prepare('DELETE FROM data_jobs WHERE name = ?').run(TICKET_REFS_JOB_NAME)
  })
}

export const ticketRefsJob: DataJob = {
  name: TICKET_REFS_JOB_NAME,
  version: 1,
  description: 'Link stored events to the tickets their branches and commits name',
  // Every link is derived again, so a rerun starts from none
  prepare: (db) => db.exec('DELETE FROM ticket_ref; DELETE FROM ticket'),
  runBatch,
  verify,
}
