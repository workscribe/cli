import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { insertEventRecord, type NewEvent } from '../../src/db/event-writer'
import { ticketsOfEvents } from '../../src/db/tickets'
import type { ProjectRecord } from '../../src/db/dimensions'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const CLI: ProjectRecord = {
  identity: 'remote:github.com/workscribe/cli',
  kind: 'remote',
  name: 'cli',
  root: '/code/cli',
}
const BRANCH = 'feat/WOR-123-context-file-details'

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  return db
}

function capture(db: DatabaseSync, overrides: Partial<NewEvent> = {}): number {
  insertEventRecord(db, {
    captured_at: '2026-10-28T12:00:00.000Z',
    command: 'npm test',
    cwd: '/code/cli',
    exit_code: 0,
    duration_ms: null,
    repo_name: 'cli',
    branch: BRANCH,
    category: 'testing',
    metadata: null,
    source: null,
    file_path: null,
    dimensions: { project: CLI, branch: BRANCH, file: null },
    tickets: { branch: ['WOR-123'], commits: [] },
    ...overrides,
  })
  return (db.prepare('SELECT MAX(id) AS id FROM events').get() as { id: number }).id
}

const refs = (db: DatabaseSync) =>
  db
    .prepare(
      `SELECT ticket.key, ticket_ref.branch_id IS NOT NULL AS onBranch, ticket_ref.event_id IS NOT NULL AS onEvent
       FROM ticket_ref JOIN ticket ON ticket.id = ticket_ref.ticket_id ORDER BY ticket.key, onBranch DESC`
    )
    .all()

describe('ticket refs', () => {
  it("links a branch's ticket to the branch and a commit's ticket to the event, once each", () => {
    const db = database()
    capture(db)
    capture(db, {
      category: 'shipping',
      metadata: JSON.stringify({ message: 'WOR-123 fix' }),
      tickets: { branch: ['WOR-123'], commits: ['WOR-123'] },
    })

    expect(refs(db)).toEqual([
      { key: 'WOR-123', onBranch: 1, onEvent: 0 },
      { key: 'WOR-123', onBranch: 0, onEvent: 1 },
    ])
    expect(db.prepare('SELECT COUNT(*) AS count FROM ticket').get()).toEqual({ count: 1 })
  })

  it('links no branch ticket for an event linked to no branch, and nothing for an event outside any project', () => {
    const db = database()
    capture(db, { dimensions: { project: CLI, branch: null, file: null } })
    capture(db, {
      dimensions: { project: null, branch: null, file: null },
      tickets: { branch: [], commits: ['WOR-9'] },
    })

    expect(refs(db)).toEqual([])
  })

  it("lists a thread's tickets from its events and their branches, sorted numerically", () => {
    const db = database()
    const first = capture(db, { tickets: { branch: ['WOR-123'], commits: [] } })
    const second = capture(db, {
      category: 'shipping',
      metadata: JSON.stringify({ message: 'WOR-9 and WOR-10' }),
      tickets: { branch: [], commits: ['WOR-9', 'WOR-10'] },
    })

    expect(ticketsOfEvents(db, [first, second])).toEqual(['WOR-9', 'WOR-10', 'WOR-123'])
    expect(ticketsOfEvents(db, [])).toEqual([])
  })

  it("drops an event's links with the event (undo, clear), keeping its branch's", () => {
    const db = database()
    const commit = capture(db, { tickets: { branch: ['WOR-123'], commits: ['WOR-7'] } })

    db.prepare('DELETE FROM events WHERE id = ?').run(commit)

    expect(refs(db)).toEqual([{ key: 'WOR-123', onBranch: 1, onEvent: 0 }])
  })

  it('refuses a ref that points at neither, or both, a branch and an event', () => {
    const db = database()
    const eventId = capture(db)
    const ticketId = (db.prepare("SELECT id FROM ticket WHERE key = 'WOR-123'").get() as { id: number }).id
    const insert = db.prepare('INSERT INTO ticket_ref (ticket_id, branch_id, event_id) VALUES (?, ?, ?)')

    expect(() => insert.run(ticketId, null, null)).toThrow(/CHECK/)
    expect(() => insert.run(ticketId, 1, eventId)).toThrow(/CHECK/)
  })
})
