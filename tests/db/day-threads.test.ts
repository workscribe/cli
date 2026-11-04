import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { currentDayStamp, getEventsInRange, replaceDayBlocks } from '../../src/db/thread-store'
import { isReadyForThreads, readDayThreads } from '../../src/db/day-threads'
import type { DataJob } from '../../src/db/jobs/types'
import { upsertAgentSession } from '../../src/db/agent-sessions'
import { buildDayBlocks } from '../../src/sessions/blocks'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const DATE = '2026-10-28'
const RANGE = { start: '2026-10-28T00:00:00.000Z', end: '2026-10-29T00:00:00.000Z' }
const BASIS = { groupingVersion: 1, idleMs: 30 * 60 * 1000 }
const CLI = 1
const SITE = 2

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  db.prepare("INSERT INTO project (identity, kind, name) VALUES ('remote:host/workscribe/cli', 'remote', 'cli')").run()
  db.prepare(
    "INSERT INTO project (identity, kind, name) VALUES ('remote:host/workscribe/landing-page', 'remote', 'landing-page')"
  ).run()
  return db
}

function insertEvent(
  db: DatabaseSync,
  event: { capturedAt: string; projectId: number | null; agentSessionId?: number }
): void {
  db.prepare(
    "INSERT INTO events (captured_at, command, cwd, category, project_id, agent_session_id) VALUES (?, 'ls', '/repo', 'files', ?, ?)"
  ).run(event.capturedAt, event.projectId, event.agentSessionId ?? null)
}

function build(db: DatabaseSync): void {
  const bounds = { startMs: Date.parse(RANGE.start), endMs: Date.parse(RANGE.end) }
  replaceDayBlocks(db, {
    date: DATE,
    dayBlocks: buildDayBlocks(getEventsInRange(db, RANGE), BASIS.idleMs, bounds),
    stamp: currentDayStamp(db, RANGE, BASIS),
  })
}

describe('readDayThreads', () => {
  it('reads each thread of an interleaved block with its key, name, events and agent sessions', () => {
    const db = database()
    const agent = upsertAgentSession(db, {
      source: 'claude-code',
      sessionId: 'abc-123',
      cwd: '/repo',
      capturedAt: '2026-10-28T12:09:00.000Z',
    })
    insertEvent(db, { capturedAt: '2026-10-28T12:09:00.000Z', projectId: CLI, agentSessionId: agent })
    insertEvent(db, { capturedAt: '2026-10-28T12:30:00.000Z', projectId: SITE })
    insertEvent(db, { capturedAt: '2026-10-28T12:31:00.000Z', projectId: CLI, agentSessionId: agent })
    insertEvent(db, { capturedAt: '2026-10-28T12:40:00.000Z', projectId: null })
    build(db)

    const [block] = readDayThreads(db, DATE)

    expect(block).toMatchObject({ date: DATE, eventCount: 4 })
    expect(
      block.threads.map((thread) => [thread.key, thread.repoName, thread.events.map((event) => event.id)])
    ).toEqual([
      ['cli|2026-10-28T12:09:00.000Z', 'cli', [1, 3]],
      ['landing-page|2026-10-28T12:30:00.000Z', 'landing-page', [2]],
      ['|2026-10-28T12:40:00.000Z', null, [4]],
    ])
    expect(block.threads[0].agentSessions).toEqual([
      {
        source: 'claude-code',
        sessionId: 'abc-123',
        startedAt: '2026-10-28T12:09:00.000Z',
        lastSeenAt: '2026-10-28T12:09:00.000Z',
      },
    ])
    expect(block.threads[1].agentSessions).toEqual([])
  })

  it('reads the anchored summaries whose range starts in each block', () => {
    const db = database()
    insertEvent(db, { capturedAt: '2026-10-28T12:09:00.000Z', projectId: CLI })
    insertEvent(db, { capturedAt: '2026-10-28T12:30:00.000Z', projectId: SITE })
    insertEvent(db, { capturedAt: '2026-10-28T18:00:00.000Z', projectId: CLI })
    build(db)
    const insertSummary = db.prepare(
      `INSERT INTO summary (scope, project_id, first_event_id, last_event_id, engine, text, created_at, source_key, origin, anchor_source)
       VALUES ('session', ?, ?, ?, 'skill', ?, '2026-10-28T20:00:00.000Z', ?, 'saved', 'thread')`
    )
    insertSummary.run(SITE, 2, 2, 'the README', 'a')
    insertSummary.run(CLI, 3, 3, 'the evening', 'b')

    const [morning, evening] = readDayThreads(db, DATE)

    expect(morning.summaries.map((summary) => summary.text)).toEqual(['the README'])
    expect(evening.summaries.map((summary) => summary.text)).toEqual(['the evening'])
  })

  it('reads nothing for a day not built yet', () => {
    expect(readDayThreads(database(), DATE)).toEqual([])
  })
})

describe('isReadyForThreads', () => {
  const job = (name: string): DataJob => ({ name, version: 1 }) as unknown as DataJob
  const JOBS = [job('project-dimensions'), job('summary-anchors')]

  function markDone(db: DatabaseSync, name: string): void {
    db.prepare("INSERT INTO data_jobs (name, version, status) VALUES (?, 1, 'done')").run(name)
  }

  it('is ready straight away for a database with no events, though no job has run', () => {
    expect(isReadyForThreads(database(), JOBS)).toBe(true)
  })

  it('waits for both jobs once there are events: linking projects alone is not enough', () => {
    const db = database()
    insertEvent(db, { capturedAt: '2026-10-28T12:09:00.000Z', projectId: CLI })

    expect(isReadyForThreads(db, JOBS)).toBe(false)
    markDone(db, 'project-dimensions')
    expect(isReadyForThreads(db, JOBS)).toBe(false)
    markDone(db, 'summary-anchors')
    expect(isReadyForThreads(db, JOBS)).toBe(true)
  })

  it('is never ready while a job it waits for is missing from the list', () => {
    const db = database()
    insertEvent(db, { capturedAt: '2026-10-28T12:09:00.000Z', projectId: CLI })
    markDone(db, 'project-dimensions')

    expect(isReadyForThreads(db, [job('project-dimensions')])).toBe(false)
  })
})
