import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import {
  currentDayStamp,
  getBlocksForDate,
  getBlockHoldingEvent,
  getEventsInRange,
  getThreadEvents,
  isSameStamp,
  readDayStamp,
  replaceDayBlocks,
} from '../../src/db/thread-store'
import { buildDayBlocks } from '../../src/sessions/blocks'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const DATE = '2026-10-28'
const RANGE = { start: '2026-10-28T00:00:00.000Z', end: '2026-10-29T00:00:00.000Z' }
const BASIS = { groupingVersion: 1, idleMs: 30 * 60 * 1000 }

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  return db
}

function insertEvent(db: DatabaseSync, capturedAt: string, projectId: number | null = null): void {
  db.prepare(
    "INSERT INTO events (captured_at, command, cwd, category, project_id) VALUES (?, 'ls', '/repo', 'files', ?)"
  ).run(capturedAt, projectId)
}

function insertProjects(db: DatabaseSync, count: number): void {
  for (let index = 1; index <= count; index++) {
    db.prepare("INSERT INTO project (identity, kind) VALUES (?, 'remote')").run(`remote:host/p${index}`)
  }
}

function build(
  db: DatabaseSync,
  day: { date: string; range: { start: string; end: string } } = { date: DATE, range: RANGE }
): void {
  const bounds = { startMs: Date.parse(day.range.start), endMs: Date.parse(day.range.end) }
  const stamp = currentDayStamp(db, day.range, BASIS)
  replaceDayBlocks(db, {
    date: day.date,
    dayBlocks: buildDayBlocks(getEventsInRange(db, day.range), BASIS.idleMs, bounds),
    stamp,
  })
}

describe('thread-store', () => {
  it("stores a day's blocks, threads, links, slots and stamp, and reads them back", () => {
    const db = database()
    insertProjects(db, 2)
    insertEvent(db, '2026-10-28T10:00:00.000Z', 1)
    insertEvent(db, '2026-10-28T10:01:00.000Z', 2)
    insertEvent(db, '2026-10-28T10:02:00.000Z', 1)

    build(db)

    const [block] = getBlocksForDate(db, DATE)
    expect(block).toMatchObject({ date: DATE, eventCount: 3, activeSlots: 1, groupingVersion: 1 })
    expect(block.threads.map((thread) => [thread.projectId, thread.eventCount])).toEqual([
      [1, 2],
      [2, 1],
    ])
    expect(getThreadEvents(db, block.threads[0].id).map((event) => event.id)).toEqual([1, 3])
    expect(db.prepare('SELECT COUNT(*) AS count FROM activity_slot').get()).toEqual({ count: 2 })
    expect(isSameStamp(readDayStamp(db, DATE), currentDayStamp(db, RANGE, BASIS))).toBe(true)
  })

  it("replaces only the day's own rows, cascading to its threads and links", () => {
    const db = database()
    insertEvent(db, '2026-10-27T10:00:00.000Z')
    insertEvent(db, '2026-10-28T10:00:00.000Z')
    const previousDay = { start: '2026-10-27T00:00:00.000Z', end: '2026-10-28T00:00:00.000Z' }
    build(db, { date: '2026-10-27', range: previousDay })
    build(db)

    insertEvent(db, '2026-10-28T10:20:00.000Z')
    build(db)

    expect(getBlocksForDate(db, '2026-10-27')).toHaveLength(1)
    expect(getBlocksForDate(db, DATE).map((block) => block.eventCount)).toEqual([2])
    expect(db.prepare('SELECT COUNT(*) AS count FROM thread').get()).toEqual({ count: 2 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM thread_event').get()).toEqual({ count: 3 })
  })

  it('changes the stamp when two events swap projects, which a plain sum would miss', () => {
    const db = database()
    insertProjects(db, 2)
    insertEvent(db, '2026-10-28T10:00:00.000Z', 1)
    insertEvent(db, '2026-10-28T10:01:00.000Z', 2)
    build(db)

    db.exec('UPDATE events SET project_id = 3 - project_id')

    expect(isSameStamp(readDayStamp(db, DATE), currentDayStamp(db, RANGE, BASIS))).toBe(false)
  })

  it('changes the stamp when links change in ways that cancel out in a plain weighted sum', () => {
    const db = database()
    insertProjects(db, 2)
    insertEvent(db, '2026-10-28T10:00:00.000Z')
    insertEvent(db, '2026-10-28T10:01:00.000Z')
    insertEvent(db, '2026-10-28T10:02:00.000Z')
    insertEvent(db, '2026-10-28T10:03:00.000Z', 1)
    build(db)
    const before = readDayStamp(db, DATE)

    // Event 4 loses project 1 (−4), event 2 gains project 2 (+4): the weighted sum stays the same
    db.exec('UPDATE events SET project_id = NULL WHERE id = 4; UPDATE events SET project_id = 2 WHERE id = 2')
    const after = currentDayStamp(db, RANGE, BASIS)

    expect(after.linkChecksum).toBe(before?.linkChecksum)
    expect(isSameStamp(before, after)).toBe(false)
  })

  it('stamps a day with no events, so an empty day reads as up to date', () => {
    const db = database()

    build(db)

    expect(readDayStamp(db, DATE)).toEqual({
      ...BASIS,
      eventCount: 0,
      linkChecksum: 0,
      linkSpread: 0,
      maxEventId: null,
    })
    expect(isSameStamp(readDayStamp(db, DATE), currentDayStamp(db, RANGE, BASIS))).toBe(true)
  })

  it('reads the day by its range, in captured order then id', () => {
    const db = database()
    insertEvent(db, '2026-10-28T10:05:00.000Z')
    insertEvent(db, '2026-10-28T10:00:00.000Z')
    insertEvent(db, '2026-10-29T00:00:00.000Z')

    expect(getEventsInRange(db, RANGE).map((event) => event.id)).toEqual([2, 1])
  })

  it('removes an event from its thread when the event is deleted', () => {
    const db = database()
    insertEvent(db, '2026-10-28T10:00:00.000Z')
    build(db)

    db.exec('DELETE FROM events')

    expect(db.prepare('SELECT COUNT(*) AS count FROM thread_event').get()).toEqual({ count: 0 })
  })

  it('gives the threads and ordered events of the block holding an event, and nothing for an event in no block', () => {
    const db = database()
    insertProjects(db, 2)
    insertEvent(db, '2026-10-28T10:00:00.000Z', 1)
    insertEvent(db, '2026-10-28T10:01:00.000Z', 2)
    build(db)
    insertEvent(db, '2026-10-28T10:02:00.000Z', 1)

    const block = getBlockHoldingEvent(db, 2)

    expect(block?.threads.map((thread) => thread.projectId)).toEqual([1, 2])
    expect(block?.events).toEqual([
      { id: 1, threadId: block?.threads[0].id },
      { id: 2, threadId: block?.threads[1].id },
    ])
    expect(getBlockHoldingEvent(db, 3)).toBeNull()
  })
})
