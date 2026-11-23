import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { cutoffOf, removeExpiredEvents, removeExpiredSummaries, removeOrphans } from '../../src/db/retention'
import { localDateOf } from '../../src/utils/format'

vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const LIMIT_DAYS = 100
const noon = (year: number, month: number, day: number) => new Date(year, month - 1, day, 12)
// Day 1 is the first day anything was captured
const DAY_ONE = noon(2026, 11, 23)
const dayAfterStart = (dayNumber: number, hour = 12) =>
  new Date(DAY_ONE.getFullYear(), DAY_ONE.getMonth(), DAY_ONE.getDate() + dayNumber - 1, hour)

function openDatabase(): { db: DatabaseSync; file: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-retention-'))
  const file = path.join(directory, 'workscribe.db')
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  onTestFinished(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return { db, file }
}

function insertEvent(db: DatabaseSync, capturedAt: Date, command = 'npm test'): number {
  const result = db
    .prepare("INSERT INTO events (captured_at, command, cwd, category) VALUES (?, ?, '/repo', 'testing')")
    .run(capturedAt.toISOString(), command)
  return Number(result.lastInsertRowid)
}

function eventDays(db: DatabaseSync): string[] {
  const rows = db.prepare('SELECT captured_at FROM events ORDER BY captured_at').all() as { captured_at: string }[]
  return rows.map((row) => localDateOf(row.captured_at))
}

const count = (db: DatabaseSync, table: string): number =>
  (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count

describe('cutoffOf', () => {
  it('is the start of the local day the limit ago, so the whole of that day is kept', () => {
    const cutoff = new Date(cutoffOf(new Date(2027, 2, 4, 15, 30), LIMIT_DAYS))

    expect(localDateOf(cutoff.toISOString())).toBe('2026-11-24')
    expect([cutoff.getHours(), cutoff.getMinutes(), cutoff.getSeconds()]).toEqual([0, 0, 0])
  })

  it('does not depend on the time of day it is asked at', () => {
    expect(cutoffOf(new Date(2027, 2, 4, 0, 0, 1), LIMIT_DAYS)).toBe(
      cutoffOf(new Date(2027, 2, 4, 23, 59, 59), LIMIT_DAYS)
    )
  })
})

describe('removeExpiredEvents', () => {
  it('removes the events before the cutoff with what hangs off them, and nothing after it', () => {
    const { db } = openDatabase()
    db.exec("INSERT INTO project (id, identity, kind, name) VALUES (1, 'local:/repo', 'local', 'repo')")
    const oldId = insertEvent(db, noon(2026, 8, 1), 'old command')
    const keptId = insertEvent(db, noon(2026, 11, 20), 'kept command')
    db.exec("INSERT INTO file (id, project_id, relative_path) VALUES (1, 1, 'a.ts')")
    db.exec(`INSERT INTO event_file (event_id, file_id, action) VALUES (${oldId}, 1, 'edit'), (${keptId}, 1, 'edit')`)
    db.exec("INSERT INTO ticket (id, key) VALUES (1, 'WOR-1')")
    db.exec(`INSERT INTO ticket_ref (ticket_id, event_id) VALUES (1, ${oldId})`)
    db.exec(
      "INSERT INTO agent_sessions (id, source, session_id, started_at, last_seen_at) VALUES (1, 'claude-code', 'a', '2026-08-01T10:00:00.000Z', '2026-08-01T10:00:00.000Z')"
    )
    db.exec(`UPDATE events SET agent_session_id = 1 WHERE id = ${oldId}`)

    const result = removeExpiredEvents(db, { cutoff: noon(2026, 11, 1).toISOString() })

    expect(result).toEqual({ events: 1, stoppedBecause: 'finished' })
    expect(db.prepare('SELECT id FROM events').all()).toEqual([{ id: keptId }])
    expect(count(db, 'ticket_ref')).toBe(0)
    expect(db.prepare('SELECT event_id FROM event_file').all()).toEqual([{ event_id: keptId }])
    expect(count(db, 'agent_sessions')).toBe(0)
  })

  it('removes an event the old session tables still link to, as before drop-old-sessions has run', () => {
    const { db } = openDatabase()
    const id = insertEvent(db, noon(2026, 8, 1))
    db.exec("INSERT INTO sessions (id, date, started_at, ended_at, event_count) VALUES (1, '2026-08-01', 'a', 'b', 1)")
    db.exec(`INSERT INTO session_events (session_id, event_id) VALUES (1, ${id})`)

    expect(removeExpiredEvents(db, { cutoff: noon(2026, 11, 1).toISOString() }).events).toBe(1)
    expect(count(db, 'events')).toBe(0)
    expect(count(db, 'session_events')).toBe(0)
  })

  it('removes a day whole or not at all: an event just before the cutoff goes, one just after stays', () => {
    const { db } = openDatabase()
    const cutoff = cutoffOf(dayAfterStart(101), LIMIT_DAYS)
    insertEvent(db, new Date(Date.parse(cutoff) - 1000))
    insertEvent(db, new Date(Date.parse(cutoff) + 1000))

    removeExpiredEvents(db, { cutoff })

    expect(count(db, 'events')).toBe(1)
  })

  it('works in batches and stops between them when its time is up', () => {
    const { db } = openDatabase()
    for (let day = 1; day <= 10; day++) insertEvent(db, dayAfterStart(day))
    let checks = 0

    const result = removeExpiredEvents(db, {
      cutoff: dayAfterStart(30).toISOString(),
      batchSize: 3,
      isOverBudget: () => ++checks > 2,
    })

    expect(result).toEqual({ events: 6, stoppedBecause: 'over-budget' })
    expect(count(db, 'events')).toBe(4)
  })

  it('stops and removes nothing more when a capture holds the write lock, leaving what it removed removed', () => {
    const { db, file } = openDatabase()
    for (let day = 1; day <= 4; day++) insertEvent(db, dayAfterStart(day))
    const capture = new DatabaseSync(file)
    onTestFinished(() => capture.close())
    capture.exec('BEGIN IMMEDIATE')

    const result = removeExpiredEvents(db, { cutoff: dayAfterStart(30).toISOString(), batchSize: 2 })
    capture.exec('ROLLBACK')

    expect(result).toEqual({ events: 0, stoppedBecause: 'locked' })
    expect(count(db, 'events')).toBe(4)
  })

  it('leaves secure_delete as it found it', () => {
    const { db } = openDatabase()
    insertEvent(db, dayAfterStart(1))
    const before = db.prepare('PRAGMA secure_delete').get()

    removeExpiredEvents(db, { cutoff: dayAfterStart(30).toISOString() })

    expect(db.prepare('PRAGMA secure_delete').get()).toEqual(before)
  })
})

describe('a rolling window', () => {
  const runOn = (db: DatabaseSync, dayNumber: number) =>
    removeExpiredEvents(db, { cutoff: cutoffOf(dayAfterStart(dayNumber, 15), LIMIT_DAYS) })

  function oneEventPerDay(db: DatabaseSync, days: number): void {
    for (let day = 1; day <= days; day++) insertEvent(db, dayAfterStart(day))
  }

  // Day N keeps the 100 full days before it, and itself: the first day goes on day 102
  it('keeps everything through day 101, then removes the oldest day, and one more day each day', () => {
    const { db } = openDatabase()
    oneEventPerDay(db, 104)

    expect(runOn(db, 100).events).toBe(0)
    expect(runOn(db, 101).events).toBe(0)
    expect(runOn(db, 102).events).toBe(1)
    expect(eventDays(db)[0]).toBe(localDateOf(dayAfterStart(2).toISOString()))
    expect(runOn(db, 103).events).toBe(1)
    expect(eventDays(db)[0]).toBe(localDateOf(dayAfterStart(3).toISOString()))
    expect(runOn(db, 103).events).toBe(0)
  })

  it('catches up after a week without a run: every day that expired meanwhile goes at once', () => {
    const { db } = openDatabase()
    oneEventPerDay(db, 109)

    expect(runOn(db, 102).events).toBe(1)
    expect(runOn(db, 109).events).toBe(7)
    expect(eventDays(db)[0]).toBe(localDateOf(dayAfterStart(9).toISOString()))
  })

  it('removes nothing for a day that had no events', () => {
    const { db } = openDatabase()
    insertEvent(db, dayAfterStart(1))
    insertEvent(db, dayAfterStart(5))

    expect(runOn(db, 102).events).toBe(1)
    expect(runOn(db, 103).events).toBe(0)
    expect(runOn(db, 106).events).toBe(1)
  })
})

describe('removeOrphans', () => {
  it('removes files and branches no event refers to, and alerts and derived days before the cutoff', () => {
    const { db } = openDatabase()
    const cutoff = noon(2026, 11, 1).toISOString()
    db.exec("INSERT INTO project (id, identity, kind, name) VALUES (1, 'local:/repo', 'local', 'repo')")
    const keptId = insertEvent(db, noon(2026, 11, 20))
    db.exec("INSERT INTO file (id, project_id, relative_path) VALUES (1, 1, 'kept.ts'), (2, 1, 'gone.ts')")
    db.exec(`INSERT INTO event_file (event_id, file_id, action) VALUES (${keptId}, 1, 'edit')`)
    db.exec("INSERT INTO branch (id, project_id, name) VALUES (1, 1, 'main'), (2, 1, 'old'), (3, 1, 'ticketed')")
    db.exec(`UPDATE events SET branch_id = 1 WHERE id = ${keptId}`)
    db.exec("INSERT INTO ticket (id, key) VALUES (1, 'WOR-1')")
    db.exec('INSERT INTO ticket_ref (ticket_id, branch_id) VALUES (1, 3)')
    db.prepare("INSERT INTO alerts (created_at, tool, context) VALUES (?, 'x', 'old'), (?, 'x', 'new')").run(
      Date.parse('2026-08-01'),
      Date.parse('2026-11-20')
    )
    for (const date of ['2026-10-31', '2026-11-01']) {
      db.exec(
        `INSERT INTO work_block (date, started_at, ended_at, event_count, active_slots, grouping_version) VALUES ('${date}', 'a', 'b', 1, 1, 1)`
      )
      db.exec(`INSERT INTO activity_slot (date, slot_start, event_count) VALUES ('${date}', 'a', 1)`)
      db.exec(`INSERT INTO grouping_day VALUES ('${date}', 1, 1, 1, 1, 1, 1)`)
    }

    const counts = removeOrphans(db, cutoff)

    expect(counts).toEqual({ files: 1, branches: 1, alerts: 1, derivedDays: 1 })
    expect(db.prepare('SELECT relative_path FROM file').all()).toEqual([{ relative_path: 'kept.ts' }])
    expect(db.prepare('SELECT name FROM branch ORDER BY id').all()).toEqual([{ name: 'main' }, { name: 'ticketed' }])
    expect(db.prepare('SELECT date FROM work_block').all()).toEqual([{ date: '2026-11-01' }])
    expect(db.prepare('SELECT date FROM activity_slot').all()).toEqual([{ date: '2026-11-01' }])
    expect(db.prepare('SELECT date FROM grouping_day').all()).toEqual([{ date: '2026-11-01' }])
    expect(count(db, 'project')).toBe(1)
  })
})

describe('removeExpiredSummaries', () => {
  function insertSummary(db: DatabaseSync, key: string, day: string | null): void {
    db.prepare(
      `INSERT INTO summary (scope, engine, text, created_at, source_key, origin, anchor_source, day)
       VALUES ('session', 'skill', 'text', '2026-11-30T10:00:00.000Z', ?, 'saved', 'thread', ?)`
    ).run(key, day)
  }

  it('removes the summaries of days before the cutoff, and keeps the others, whatever day they were saved on', () => {
    const { db } = openDatabase()
    insertSummary(db, 'a|1', '2026-07-31')
    insertSummary(db, 'a|2', '2026-10-31')
    insertSummary(db, 'a|3', '2026-11-01')
    insertSummary(db, 'a|4', '2026-11-20')

    const removed = removeExpiredSummaries(db, noon(2026, 11, 1).toISOString())

    expect(removed).toBe(2)
    expect(db.prepare('SELECT day FROM summary ORDER BY day').all()).toEqual([
      { day: '2026-11-01' },
      { day: '2026-11-20' },
    ])
  })

  it('never removes a summary whose day is not known: it cannot be said to be old', () => {
    const { db } = openDatabase()
    insertSummary(db, 'a|1', null)

    expect(removeExpiredSummaries(db, noon(2026, 11, 1).toISOString())).toBe(0)
    expect(count(db, 'summary')).toBe(1)
  })
})
