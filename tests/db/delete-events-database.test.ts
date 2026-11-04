import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// Real SQLite: `undo` and `clear` delete events under foreign keys — with old sessions still linked to them, as
// before the drop-old-sessions job runs, and after it. The database path points at a temp folder before the module
// loads.
const temp = vi.hoisted(async () => {
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-delete-'))
  return { directory, databasePath: path.join(directory, 'workscribe.db') }
})
vi.mock('../../src/utils/paths', async () => {
  const { directory, databasePath } = await temp
  return { WORKSCRIBE_DIR: directory, DB_PATH: databasePath }
})
vi.mock('../../src/config', () => ({
  readConfig: vi.fn(() => ({ session: { idleTimeout: 30 }, capture: { aiTools: true } })),
}))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))
vi.mock('../../src/config/registry', () => ({ loadAIToolRegistry: vi.fn(() => []) }))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { deleteEventsByIds, deleteEventsForDate, getDb, insertEvent } from '../../src/db'
import initialSchema from '../../src/db/migrations/001_initial_schema'
import { localDateOf } from '../../src/utils/format'
import { DB_PATH } from '../../src/utils/paths'

// Midday UTC, so the local day is the same in every time zone the tests run in
const at = (minutes: number) => new Date(Date.parse('2026-10-31T12:00:00.000Z') + minutes * 60_000).toISOString()
const DATE = localDateOf(at(0))

function captureAgentCommand(minutes: number, sessionId: string): void {
  insertEvent({
    captured_at: at(minutes),
    command: `npm test ${minutes}`,
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 10,
    repo_name: 'api',
    branch: 'main',
    category: 'testing',
    metadata: null,
    source: 'claude-code',
    file_path: null,
    agentSession: { source: 'claude-code', sessionId },
  })
}

/** An old session over these events, as databases grouped before WOR-151 have — its links point at the events. */
function groupIntoOldSession(eventIds: number[]): void {
  const { id } = getDb()
    .prepare(
      `INSERT INTO sessions (date, started_at, ended_at, repo_name, event_count) VALUES (?, ?, ?, 'api', ?) RETURNING id`
    )
    .get(DATE, at(0), at(10), eventIds.length) as { id: number }
  const link = getDb().prepare('INSERT INTO session_events (session_id, event_id) VALUES (?, ?)')
  for (const eventId of eventIds) link.run(id, eventId)
}

const eventIds = () =>
  (getDb().prepare('SELECT id FROM events ORDER BY id').all() as { id: number }[]).map((row) => row.id)

const sessionIds = () =>
  (getDb().prepare('SELECT session_id FROM agent_sessions ORDER BY id').all() as { session_id: string }[]).map(
    (row) => row.session_id
  )

if (!fs.realpathSync(path.dirname(DB_PATH)).startsWith(fs.realpathSync(os.tmpdir()))) {
  throw new Error(`delete-events-database.test.ts must use a temp database, not ${DB_PATH}`)
}

beforeEach(() => {
  // A test may have dropped the old tables, as the data job does: bring them back as migration 001 made them
  getDb().exec(initialSchema.sql)
  getDb().exec('DELETE FROM session_events; DELETE FROM sessions; DELETE FROM events; DELETE FROM agent_sessions')
})

afterAll(async () => {
  getDb().close()
  fs.rmSync((await temp).directory, { recursive: true, force: true })
})

describe('deleting events on a real database', () => {
  it('undo removes the agent session its last event belonged to, and keeps one that still has events', () => {
    captureAgentCommand(0, 'conversation-1')
    captureAgentCommand(5, 'conversation-2')
    captureAgentCommand(10, 'conversation-2')
    groupIntoOldSession(eventIds())
    const ids = eventIds()

    deleteEventsByIds([ids[0], ids[1]])

    expect(sessionIds()).toEqual(['conversation-2'])
  })

  it('undo deletes an event an old session still links to, and the link with it', () => {
    captureAgentCommand(0, 'conversation-1')
    captureAgentCommand(5, 'conversation-1')
    groupIntoOldSession(eventIds())
    const [first] = eventIds()

    deleteEventsByIds([first])

    expect(getDb().prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 1 })
    expect(getDb().prepare('SELECT event_id FROM session_events WHERE event_id = ?').all(first)).toEqual([])
  })

  it('undo deletes events no old session links to', () => {
    captureAgentCommand(0, 'conversation-1')
    const [first] = eventIds()

    deleteEventsByIds([first])

    expect(sessionIds()).toEqual([])
  })

  it('clear deletes a day an old session still links to', () => {
    captureAgentCommand(0, 'conversation-1')
    groupIntoOldSession(eventIds())

    expect(deleteEventsForDate(DATE)).toBe(1)
    expect(sessionIds()).toEqual([])
  })
})

describe('deleting events once the old session tables are dropped', () => {
  beforeEach(() => {
    getDb().exec('DROP TABLE session_events; DROP TABLE sessions; DROP TABLE IF EXISTS session_summaries')
  })

  it('undo still deletes events and their emptied agent sessions', () => {
    captureAgentCommand(0, 'conversation-1')
    captureAgentCommand(5, 'conversation-2')

    deleteEventsByIds([eventIds()[0]])

    expect(eventIds()).toHaveLength(1)
    expect(sessionIds()).toEqual(['conversation-2'])
  })

  it("clear still deletes a day's events", () => {
    captureAgentCommand(0, 'conversation-1')

    expect(deleteEventsForDate(DATE)).toBe(1)
  })
})
