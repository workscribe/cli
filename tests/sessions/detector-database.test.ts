import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// The one test that loads the real `src/db` (CLAUDE.md says not to): every command now groups sessions through
// `ensureDayGrouped`, so its clear and rebuild must be checked on real SQLite — foreign keys, the lock, the summary
// carry-over. The database path points at a temp folder before the module loads, so it never opens ~/.workscribe.
const temp = vi.hoisted(async () => {
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-detector-'))
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
import { DatabaseSync } from 'node:sqlite'
import { getDb, insertEvent } from '../../src/db'
import { isDatabaseLocked } from '../../src/db/transaction'
import { ensureDayGrouped, getOrBuildSessions } from '../../src/sessions/detector'
import { localDateOf } from '../../src/utils/format'
import { DB_PATH } from '../../src/utils/paths'

// Midday UTC, so the local day is the same in every time zone the tests run in
const DAY_START = '2026-10-28T12:00:00.000Z'
const DATE = localDateOf(DAY_START)
const minutesAfterStart = (minutes: number) => new Date(Date.parse(DAY_START) + minutes * 60_000).toISOString()

function capture(minutes: number, command = `npm test ${minutes}`): void {
  insertEvent({
    captured_at: minutesAfterStart(minutes),
    command,
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 10,
    repo_name: 'api',
    branch: 'main',
    category: 'testing',
    metadata: null,
    source: null,
    file_path: null,
  })
}

const sessionRows = () =>
  getDb().prepare('SELECT id, started_at, event_count, summary FROM sessions ORDER BY started_at').all() as {
    id: number
    started_at: string
    event_count: number
    summary: string | null
  }[]

// The clean-up below deletes every row: refuse to run it anywhere but the temp database, so a broken mock fails the
// test instead of emptying a real one
if (!fs.realpathSync(path.dirname(DB_PATH)).startsWith(fs.realpathSync(os.tmpdir()))) {
  throw new Error(`detector-database.test.ts must use a temp database, not ${DB_PATH}`)
}

beforeEach(() => {
  getDb().exec('DELETE FROM session_events; DELETE FROM sessions; DELETE FROM events')
})

afterAll(async () => {
  getDb().close()
  fs.rmSync((await temp).directory, { recursive: true, force: true })
})

describe('getOrBuildSessions on a real database', () => {
  it("groups a day's events into a session with all of its events", () => {
    capture(0)
    capture(5)

    const sessions = getOrBuildSessions(DATE)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ startedAt: minutesAfterStart(0), eventCount: 2, repoName: 'api' })
    expect(sessions[0].events.map((event) => event.captured_at)).toEqual([minutesAfterStart(0), minutesAfterStart(5)])
  })

  it('leaves an up-to-date day alone — the same session rows, no rebuild', () => {
    capture(0)
    const [before] = getOrBuildSessions(DATE)

    const [after] = getOrBuildSessions(DATE)

    expect(after.id).toBe(before.id)
  })

  it('rebuilds when a session grows, keeping the summary stored on the session it replaces', () => {
    capture(0)
    const [session] = getOrBuildSessions(DATE)
    getDb().prepare('UPDATE sessions SET summary = ? WHERE id = ?').run('kept across the rebuild', session.id)

    capture(10)
    const sessions = getOrBuildSessions(DATE)

    expect(sessions).toHaveLength(1)
    expect(sessions[0]).toMatchObject({ eventCount: 2, summary: 'kept across the rebuild' })
    expect(sessions[0].id).not.toBe(session.id)
  })

  it('clears sessions left on a day that no longer has events', () => {
    capture(0)
    getOrBuildSessions(DATE)
    getDb().exec('DELETE FROM session_events; DELETE FROM events')

    expect(getOrBuildSessions(DATE)).toEqual([])
    expect(sessionRows()).toEqual([])
  })
})

describe('ensureDayGrouped on a real database — another process holding the lock', () => {
  it('gives up after the lock wait with a locked error, and changes nothing', async () => {
    capture(0)
    getOrBuildSessions(DATE)
    capture(10)
    const otherProcess = new DatabaseSync((await temp).databasePath)
    otherProcess.exec('BEGIN IMMEDIATE')

    let error: unknown = null
    try {
      ensureDayGrouped(DATE, { lockWaitMs: 50 })
    } catch (caught) {
      error = caught
    } finally {
      otherProcess.exec('ROLLBACK')
      otherProcess.close()
    }

    expect(isDatabaseLocked(error)).toBe(true)
    expect(sessionRows().map((row) => row.event_count)).toEqual([1])
    // The lock wait is back to normal, and the day groups once the lock is free
    ensureDayGrouped(DATE)
    expect(sessionRows().map((row) => row.event_count)).toEqual([2])
  })
})
