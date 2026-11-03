import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// Real SQLite, like detector-database.test.ts: `undo` and `clear` delete events under foreign keys, with old
// sessions grouped over them. The database path points at a temp folder before the module loads.
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
import { getOrBuildSessions } from '../../src/sessions/detector'
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

const sessionIds = () =>
  (getDb().prepare('SELECT session_id FROM agent_sessions ORDER BY id').all() as { session_id: string }[]).map(
    (row) => row.session_id
  )

if (!fs.realpathSync(path.dirname(DB_PATH)).startsWith(fs.realpathSync(os.tmpdir()))) {
  throw new Error(`delete-events-database.test.ts must use a temp database, not ${DB_PATH}`)
}

beforeEach(() => {
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
    getOrBuildSessions(DATE)
    const ids = (getDb().prepare('SELECT id FROM events ORDER BY id').all() as { id: number }[]).map((row) => row.id)

    deleteEventsByIds([ids[0], ids[1]])

    expect(sessionIds()).toEqual(['conversation-2'])
  })

  it('undo still deletes an event whose session was grouped under another day, as after a time zone change', () => {
    captureAgentCommand(0, 'conversation-1')
    captureAgentCommand(5, 'conversation-1')
    getOrBuildSessions(DATE)
    // Grouped somewhere the event fell on the day before: its session is stored under that date
    getDb().prepare("UPDATE sessions SET date = date($date, '-1 day')").run({ date: DATE })
    const [first] = (getDb().prepare('SELECT id FROM events ORDER BY id').all() as { id: number }[]).map(
      (row) => row.id
    )

    deleteEventsByIds([first])

    expect(getDb().prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 1 })
    expect(getDb().prepare('SELECT event_id FROM session_events WHERE event_id = ?').all(first)).toEqual([])
  })

  it('undo deletes events from a day that was never grouped', () => {
    captureAgentCommand(0, 'conversation-1')
    const [first] = (getDb().prepare('SELECT id FROM events').all() as { id: number }[]).map((row) => row.id)

    deleteEventsByIds([first])

    expect(sessionIds()).toEqual([])
  })

  it('clear deletes a day whose session was grouped under another day', () => {
    captureAgentCommand(0, 'conversation-1')
    getOrBuildSessions(DATE)
    getDb().prepare("UPDATE sessions SET date = date($date, '-1 day')").run({ date: DATE })

    expect(deleteEventsForDate(DATE)).toBe(1)
  })

  it("clear removes the day's agent sessions with its events", () => {
    captureAgentCommand(0, 'conversation-1')
    getOrBuildSessions(DATE)

    expect(deleteEventsForDate(DATE)).toBe(1)
    expect(sessionIds()).toEqual([])
  })
})
