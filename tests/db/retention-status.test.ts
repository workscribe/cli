import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { JOBS } from '../../src/db/jobs'
import { GATE_JOB_NAMES, runRetention } from '../../src/db/retention-run'
import { retentionStatusOf } from '../../src/db/retention-status'
import { setKeepForeverMirror } from '../../src/db/retention-state'
import { localDateStr } from '../../src/utils/format'

vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const POLICY = { status: 'ok' as const, retention: { days: 100, keepForever: false, summaryDays: null } }
const DAY_ONE = new Date(2026, 10, 23, 9)
const onDay = (dayNumber: number) =>
  new Date(DAY_ONE.getFullYear(), DAY_ONE.getMonth(), DAY_ONE.getDate() + dayNumber - 1, 9)

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  for (const job of JOBS.filter((candidate) => GATE_JOB_NAMES.includes(candidate.name))) {
    db.prepare("INSERT INTO data_jobs (name, version, cursor, status) VALUES (?, ?, 0, 'done')").run(
      job.name,
      job.version
    )
  }
  onTestFinished(() => db.close())
  return db
}

function insertEvent(db: DatabaseSync, capturedAt: Date): void {
  db.prepare("INSERT INTO events (captured_at, command, cwd, category) VALUES (?, 'npm test', '/repo', 'testing')").run(
    capturedAt.toISOString()
  )
}

const statusOn = (db: DatabaseSync, day: number, policy = POLICY) =>
  retentionStatusOf(db, { now: onDay(day), policy, jobs: JOBS })

describe('retentionStatusOf', () => {
  it('on a fresh install says the oldest day goes on day 102, and what that takes', () => {
    const db = database()
    insertEvent(db, onDay(1))

    expect(statusOn(db, 1)).toMatchObject({
      mode: 'waiting',
      oldestDay: localDateStr(onDay(1)),
      oldestDayRemovedOn: localDateStr(onDay(102)),
      startsOn: localDateStr(onDay(102)),
      next: { on: localDateStr(onDay(102)), events: 1, eventDays: 1 },
    })
  })

  it('does not change anything: asking never starts the clock', () => {
    const db = database()
    insertEvent(db, onDay(1))

    statusOn(db, 1)

    expect(db.prepare("SELECT COUNT(*) AS count FROM meta WHERE key LIKE 'retention:%'").get()).toEqual({ count: 0 })
  })

  it('uses the announced day once the first run has started the clock', () => {
    const db = database()
    insertEvent(db, onDay(1))
    runRetention(db, { now: onDay(200), policy: POLICY, jobs: JOBS, backupsDirectory: '/none', canVacuum: false })

    expect(statusOn(db, 203)).toMatchObject({ mode: 'waiting', startsOn: localDateStr(onDay(214)) })
  })

  it('says the oldest day goes the next day once removal runs, then the one after when it already ran today', () => {
    const db = database()
    for (let day = 1; day <= 104; day++) insertEvent(db, onDay(day))
    runRetention(db, { now: onDay(1), policy: POLICY, jobs: JOBS, backupsDirectory: '/none', canVacuum: false })

    expect(statusOn(db, 102)).toMatchObject({ mode: 'removing', next: { on: localDateStr(onDay(102)), events: 1 } })
    runRetention(db, { now: onDay(102), policy: POLICY, jobs: JOBS, backupsDirectory: '/none', canVacuum: false })

    const after = statusOn(db, 102)
    expect(after).toMatchObject({ mode: 'removing', oldestDay: localDateStr(onDay(2)) })
    expect(after.next).toMatchObject({ on: localDateStr(onDay(103)), events: 1 })
  })

  it.each([
    ['keeping everything is on', { ...POLICY, retention: { ...POLICY.retention, keepForever: true } }, 'keep-forever'],
    ['the config is unreadable', { status: 'unreadable' as const, reason: 'broken' }, 'unreadable'],
  ])('says nothing is removed when %s, and has no next removal', (_name, policy, mode) => {
    const db = database()
    insertEvent(db, onDay(1))

    expect(statusOn(db, 300, policy)).toMatchObject({ mode, next: null, startsOn: null, oldestDayRemovedOn: null })
  })

  it('says nothing is removed when keeping everything is recorded in the database', () => {
    const db = database()
    setKeepForeverMirror(db, true)

    expect(statusOn(db, 300).mode).toBe('keep-forever')
  })

  it('names the job it is paused on', () => {
    const db = database()
    db.prepare("UPDATE data_jobs SET status = 'failed' WHERE name = 'summary-days'").run()

    expect(statusOn(db, 300)).toMatchObject({ mode: 'paused', pausedBy: 'summary-days' })
  })

  it('has no oldest day when nothing is stored', () => {
    expect(statusOn(database(), 1)).toMatchObject({ oldestDay: null, oldestDayRemovedOn: null })
  })
})
