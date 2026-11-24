import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { JOBS } from '../../src/db/jobs'
import { summaryDaysJob } from '../../src/db/jobs/summary-days'
import { dropOldSessionsJob } from '../../src/db/jobs/drop-old-sessions'
import { localDateOf } from '../../src/utils/format'
import { getSummaryBySource, saveAnchoredSummary } from '../../src/db/summary-store'

vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const THREAD_START = '2026-10-28T09:00:00.000Z'
const KEY = `api|${THREAD_START}`
const ANCHOR = { projectId: 4, firstEventId: 7, lastEventId: 9, isMixed: false }

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  return db
}

function insertSummary(
  db: DatabaseSync,
  row: { key: string | null; firstEventId?: number | null; day?: string | null }
) {
  const result = db
    .prepare(
      `INSERT INTO summary (scope, first_event_id, engine, text, created_at, source_key, origin, anchor_source, day)
       VALUES ('session', ?, 'skill', 'text', '2026-11-30T10:00:00.000Z', ?, 'saved', 'thread', ?)`
    )
    .run(row.firstEventId ?? null, row.key, row.day ?? null)
  return Number(result.lastInsertRowid)
}

const dayOfRow = (db: DatabaseSync, id: number) =>
  (db.prepare('SELECT day FROM summary WHERE id = ?').get(id) as { day: string | null }).day

describe('summary-days job (WOR-179)', () => {
  it('runs before drop-old-sessions, which has to stay last', () => {
    const names = JOBS.map((job) => job.name)
    expect(names.indexOf('summary-days')).toBeGreaterThan(-1)
    expect(names.indexOf('summary-days')).toBeLessThan(names.indexOf(dropOldSessionsJob.name))
  })

  it("gives a summary the day its key's thread started, not the day it was saved", () => {
    const db = database()
    const id = insertSummary(db, { key: KEY })

    const result = summaryDaysJob.runBatch(db, 0, 100)

    expect(dayOfRow(db, id)).toBe(localDateOf(THREAD_START))
    expect(dayOfRow(db, id)).not.toBe('2026-11-30')
    expect(result.issues).toEqual([])
  })

  it("falls back to the first event's day when the key names none", () => {
    const db = database()
    const eventId = Number(
      db
        .prepare(
          "INSERT INTO events (captured_at, command, cwd, category) VALUES ('2026-09-02T12:00:00.000Z', 'ls', '/r', 'files')"
        )
        .run().lastInsertRowid
    )
    const id = insertSummary(db, { key: 'not a key', firstEventId: eventId })

    summaryDaysJob.runBatch(db, 0, 100)

    expect(dayOfRow(db, id)).toBe(
      (
        db.prepare("SELECT date(captured_at, 'localtime') AS day FROM events WHERE id = ?").get(eventId) as {
          day: string
        }
      ).day
    )
  })

  it('leaves a summary with no readable day as it is, and records why', () => {
    const db = database()
    const id = insertSummary(db, { key: null, firstEventId: null })

    const result = summaryDaysJob.runBatch(db, 0, 100)

    expect(dayOfRow(db, id)).toBeNull()
    expect(result.issues).toHaveLength(1)
    expect(summaryDaysJob.verify(db)).toMatchObject({ checked: 1, unresolved: 1, hasPassed: true })
  })

  it('never rewrites a day a row already has', () => {
    const db = database()
    const id = insertSummary(db, { key: KEY, day: '2020-01-01' })

    const result = summaryDaysJob.runBatch(db, 0, 100)

    expect(dayOfRow(db, id)).toBe('2020-01-01')
    expect(result.lastId).toBeNull()
  })

  it('walks the table in batches, then reports that nothing is left', () => {
    const db = database()
    const ids = [1, 2, 3].map((index) => insertSummary(db, { key: `api|2026-10-2${index}T09:00:00.000Z` }))

    const first = summaryDaysJob.runBatch(db, 0, 2)
    const second = summaryDaysJob.runBatch(db, first.lastId ?? 0, 2)
    const third = summaryDaysJob.runBatch(db, second.lastId ?? 0, 2)

    expect(first.lastId).toBe(ids[1])
    expect(second.lastId).toBe(ids[2])
    expect(third.lastId).toBeNull()
    expect(ids.every((id) => dayOfRow(db, id) !== null)).toBe(true)
  })
})

describe('a summary saved from now on', () => {
  it('carries its day, and a re-save keeps it', () => {
    const db = database()
    const record = {
      sourceKey: KEY,
      engine: 'skill' as const,
      text: 'first',
      createdAt: '2026-11-30T10:00:00.000Z',
      anchor: ANCHOR,
      anchorSource: 'thread' as const,
    }

    saveAnchoredSummary(db, record)
    saveAnchoredSummary(db, { ...record, text: 'second' })

    expect(getSummaryBySource(db, KEY, 'skill')).toMatchObject({ text: 'second', day: localDateOf(THREAD_START) })
  })

  it('does not lose the day when a re-save of the same summary has a key that names none', () => {
    const db = database()
    const record = {
      sourceKey: 'not a key',
      engine: 'skill' as const,
      text: 'first',
      createdAt: '2026-11-30T10:00:00.000Z',
      anchor: ANCHOR,
      anchorSource: 'thread' as const,
    }
    saveAnchoredSummary(db, record)
    db.prepare("UPDATE summary SET day = '2026-10-28' WHERE source_key = 'not a key'").run()

    saveAnchoredSummary(db, { ...record, text: 'second' })

    expect(getSummaryBySource(db, 'not a key', 'skill')).toMatchObject({ text: 'second', day: '2026-10-28' })
  })
})
