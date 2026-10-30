import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// Real SQLite, like detector-database.test.ts: the day's rebuild must be checked under the real lock, with foreign
// keys on. The database path points at a temp folder before the module loads, so it never opens ~/.workscribe.
const temp = vi.hoisted(async () => {
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-threads-'))
  return { directory, databasePath: path.join(directory, 'workscribe.db') }
})
vi.mock('../../src/utils/paths', async () => {
  const { directory, databasePath } = await temp
  return { WORKSCRIBE_DIR: directory, DB_PATH: databasePath }
})
vi.mock('../../src/config', () => ({ readConfig: vi.fn() }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))
vi.mock('../../src/config/registry', () => ({ loadAIToolRegistry: vi.fn(() => []) }))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { getDb, insertEvent } from '../../src/db'
import { readConfig } from '../../src/config'
import { isDatabaseLocked } from '../../src/db/transaction'
import { ensureDayThreads, getOrBuildBlocks } from '../../src/sessions/threads'
import { localDateOf } from '../../src/utils/format'
import { DB_PATH } from '../../src/utils/paths'

// Midday UTC, so the local day is the same in every time zone the tests run in
const DAY_START = '2026-10-28T12:00:00.000Z'
const DATE = localDateOf(DAY_START)
const minutesAfterStart = (minutes: number) => new Date(Date.parse(DAY_START) + minutes * 60_000).toISOString()

function useIdleTimeout(minutes: number): void {
  vi.mocked(readConfig).mockReturnValue({
    session: { idleTimeout: minutes },
    capture: { aiTools: true },
  } as ReturnType<typeof readConfig>)
}

function capture(minutes: number): void {
  insertEvent({
    captured_at: minutesAfterStart(minutes),
    command: `npm test ${minutes}`,
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

const blockIds = () =>
  (getDb().prepare('SELECT id FROM work_block ORDER BY id').all() as { id: number }[]).map((row) => row.id)

// The clean-up below deletes every row: refuse to run it anywhere but the temp database
if (!fs.realpathSync(path.dirname(DB_PATH)).startsWith(fs.realpathSync(os.tmpdir()))) {
  throw new Error(`threads-database.test.ts must use a temp database, not ${DB_PATH}`)
}

beforeEach(() => {
  useIdleTimeout(30)
  getDb().exec(
    'DELETE FROM work_block; DELETE FROM activity_slot; DELETE FROM grouping_day; DELETE FROM session_events; DELETE FROM sessions; DELETE FROM events'
  )
})

afterAll(async () => {
  getDb().close()
  fs.rmSync((await temp).directory, { recursive: true, force: true })
})

describe('getOrBuildBlocks on a real database', () => {
  it("builds the day's blocks and threads, and leaves an up-to-date day alone", () => {
    capture(0)
    capture(5)

    const [block] = getOrBuildBlocks(DATE)
    const idsAfterFirstBuild = blockIds()
    getOrBuildBlocks(DATE)

    expect(block).toMatchObject({ startedAt: minutesAfterStart(0), eventCount: 2, activeSlots: 2 })
    expect(block.threads).toHaveLength(1)
    expect(blockIds()).toEqual(idsAfterFirstBuild)
  })

  it('rebuilds when an event is added', () => {
    capture(0)
    getOrBuildBlocks(DATE)

    capture(10)

    expect(getOrBuildBlocks(DATE).map((block) => block.eventCount)).toEqual([2])
  })

  it('rebuilds when an event that is not the newest is deleted', () => {
    capture(0)
    capture(5)
    capture(10)
    getOrBuildBlocks(DATE)

    getDb().exec('DELETE FROM events WHERE id = (SELECT MIN(id) FROM events)')

    expect(getOrBuildBlocks(DATE).map((block) => block.eventCount)).toEqual([2])
  })

  it("rebuilds when an event's project link changes", () => {
    capture(0)
    getOrBuildBlocks(DATE)
    getDb().exec("INSERT INTO project (identity, kind) VALUES ('remote:host/api', 'remote')")
    getDb().exec('UPDATE events SET project_id = 1')

    const [block] = getOrBuildBlocks(DATE)

    expect(block.threads.map((thread) => thread.projectId)).toEqual([1])
  })

  it('rebuilds when the idle timeout changes', () => {
    capture(0)
    capture(20)
    expect(getOrBuildBlocks(DATE)).toHaveLength(1)

    useIdleTimeout(10)

    expect(getOrBuildBlocks(DATE)).toHaveLength(2)
  })

  it('rebuilds a day built by another grouping version', () => {
    capture(0)
    getOrBuildBlocks(DATE)
    const before = blockIds()
    getDb().exec('UPDATE grouping_day SET grouping_version = 0')

    getOrBuildBlocks(DATE)

    expect(blockIds()).not.toEqual(before)
  })

  it('stamps a day with no events, and does nothing the next time', () => {
    expect(getOrBuildBlocks(DATE)).toEqual([])
    const stamp = getDb().prepare('SELECT * FROM grouping_day').all()

    getOrBuildBlocks(DATE)

    expect(stamp).toHaveLength(1)
    expect(getDb().prepare('SELECT * FROM grouping_day').all()).toEqual(stamp)
  })

  it('never touches the old sessions', () => {
    capture(0)
    getDb()
      .prepare(
        "INSERT INTO sessions (date, started_at, ended_at, repo_name, event_count) VALUES (?, 'a', 'b', 'api', 1)"
      )
      .run(DATE)
    const sessionsBefore = getDb().prepare('SELECT * FROM sessions').all()

    getOrBuildBlocks(DATE)

    expect(getDb().prepare('SELECT * FROM sessions').all()).toEqual(sessionsBefore)
  })
})

describe('ensureDayThreads on a real database — another process holding the lock', () => {
  it('gives up after the lock wait with a locked error, and changes nothing', async () => {
    capture(0)
    getOrBuildBlocks(DATE)
    capture(10)
    const otherProcess = new DatabaseSync((await temp).databasePath)
    otherProcess.exec('BEGIN IMMEDIATE')

    let error: unknown = null
    try {
      ensureDayThreads(DATE, { lockWaitMs: 50 })
    } catch (caught) {
      error = caught
    } finally {
      otherProcess.exec('ROLLBACK')
      otherProcess.close()
    }

    expect(isDatabaseLocked(error)).toBe(true)
    expect(getDb().prepare('SELECT event_count FROM work_block').all() as { event_count: number }[]).toEqual([
      { event_count: 1 },
    ])
  })
})
