import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import path from 'path'
import { JOBS } from '../../src/db/jobs'
import { GATE_JOB_NAMES, runRetention } from '../../src/db/retention-run'
import { GRACE_DAYS, addDays, daysBetween } from '../../src/db/retention-schedule'
import type { RetentionRunOptions } from '../../src/db/retention-run'
import { getMetaValue, setMetaValue } from '../../src/db/jobs/store'
import { SEEN_KEY, restartAnnouncement, setKeepForeverMirror } from '../../src/db/retention-state'
import { localDateStr } from '../../src/utils/format'
import { countRows, insertEventAt, openTemporaryDatabase } from '../helpers/retention-db'

vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const LIMIT_DAYS = 100
const POLICY = {
  status: 'ok' as const,
  retention: { days: LIMIT_DAYS, keepForever: false, summaryDays: null },
  isDefault: false,
}
const DAY_ONE = new Date(2026, 10, 23, 9)
const onDay = (dayNumber: number, hour = 9) =>
  new Date(DAY_ONE.getFullYear(), DAY_ONE.getMonth(), DAY_ONE.getDate() + dayNumber - 1, hour)

interface Setup {
  db: DatabaseSync
  backups: string
}

function setup(options: { gatesDone?: boolean } = {}): Setup {
  const { db, directory } = openTemporaryDatabase({ gatesDone: options.gatesDone !== false })
  return { db, backups: path.join(directory, 'backups') }
}

const insertEvent = (db: DatabaseSync, capturedAt: Date): void => {
  insertEventAt(db, capturedAt)
}

const eventCount = (db: DatabaseSync): number => countRows(db, 'events')

/** Someone who uses Workscribe regularly: the last run was the day before removal starts, not weeks ago. */
function usedRegularly(fixture: Setup, lastDay = 101): void {
  setMetaValue(fixture.db, SEEN_KEY, localDateStr(onDay(lastDay)))
}

function run(fixture: Setup, now: Date, overrides: Partial<RetentionRunOptions> = {}) {
  return runRetention(fixture.db, {
    now,
    policy: POLICY,
    jobs: JOBS,
    backupsDirectory: fixture.backups,
    canVacuum: false,
    ...overrides,
  })
}

describe('date helpers', () => {
  it('adds and counts whole days across a month and a year', () => {
    expect(addDays('2026-11-23', 14)).toBe('2026-12-07')
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02')
    expect(daysBetween('2026-11-23', '2027-03-04')).toBe(101)
  })
})

describe('runRetention: when it does nothing (WOR-179)', () => {
  it.each([
    ['the config is unreadable', { policy: { status: 'unreadable' as const, reason: 'broken' } }, 'unreadable'],
    [
      'keeping everything is set',
      { policy: { ...POLICY, retention: { ...POLICY.retention, keepForever: true } } },
      'keep-forever',
    ],
  ])('removes nothing when %s', (_name, overrides, kind) => {
    const fixture = setup()
    insertEvent(fixture.db, onDay(1))

    const outcome = run(fixture, onDay(300), overrides)

    expect(outcome).toMatchObject({ status: 'skipped', reason: { kind } })
    expect(eventCount(fixture.db)).toBe(1)
  })

  it('removes nothing when keeping everything was recorded in the database, even if the config says otherwise', () => {
    const fixture = setup()
    insertEvent(fixture.db, onDay(1))
    setKeepForeverMirror(fixture.db, true)

    expect(run(fixture, onDay(300))).toMatchObject({ status: 'skipped', reason: { kind: 'keep-forever' } })
    expect(eventCount(fixture.db)).toBe(1)
  })

  it.each(GATE_JOB_NAMES)('is paused, and says which job, while %s has not finished', (name) => {
    const fixture = setup()
    fixture.db.prepare("UPDATE data_jobs SET status = 'failed' WHERE name = ?").run(name)
    insertEvent(fixture.db, onDay(1))

    expect(run(fixture, onDay(300))).toEqual({ status: 'skipped', reason: { kind: 'paused', job: name } })
    expect(eventCount(fixture.db)).toBe(1)
  })

  it('is paused when the jobs have never run', () => {
    const fixture = setup({ gatesDone: false })

    expect(run(fixture, onDay(300))).toMatchObject({ status: 'skipped', reason: { kind: 'paused' } })
  })
})

describe('runRetention: the first run announces and removes nothing', () => {
  it('for an install with old events, starts a 14 day grace', () => {
    const fixture = setup()
    insertEvent(fixture.db, onDay(1))
    const today = onDay(200)

    const outcome = run(fixture, today)

    expect(outcome).toMatchObject({
      status: 'announced',
      days: LIMIT_DAYS,
      firstRemovalOn: addDays(localDateStr(today), GRACE_DAYS),
    })
    expect(eventCount(fixture.db)).toBe(1)
  })

  it('waits out the grace, saying how many days are left, and removes nothing', () => {
    const fixture = setup()
    insertEvent(fixture.db, onDay(1))
    run(fixture, onDay(200))

    expect(run(fixture, onDay(205))).toMatchObject({ status: 'waiting', daysUntil: GRACE_DAYS - 5 })
    expect(eventCount(fixture.db)).toBe(1)
  })

  it('for a fresh install, names day 102, the first day anything has expired', () => {
    const fixture = setup()
    insertEvent(fixture.db, onDay(1))

    const outcome = run(fixture, onDay(1, 10))

    expect(outcome).toMatchObject({ status: 'announced', firstRemovalOn: localDateStr(onDay(102)) })
  })

  it('for an install with no events yet, counts from today', () => {
    const fixture = setup()

    expect(run(fixture, onDay(1))).toMatchObject({ status: 'announced', firstRemovalOn: localDateStr(onDay(102)) })
  })

  it('announces once: the dates are kept, not worked out again', () => {
    const fixture = setup()
    insertEvent(fixture.db, onDay(1))
    run(fixture, onDay(200))
    const first = getMetaValue(fixture.db, 'retention:first-removal')

    run(fixture, onDay(203))

    expect(getMetaValue(fixture.db, 'retention:first-removal')).toBe(first)
  })
})

describe('runRetention: removing', () => {
  /** An install that has been told, and is on the first day anything is removed. */
  function startedFixture(): Setup {
    const fixture = setup()
    for (let day = 1; day <= 104; day++) insertEvent(fixture.db, onDay(day))
    run(fixture, onDay(1, 10))
    usedRegularly(fixture)
    return fixture
  }

  it('removes one day a day once it starts: nothing on day 101, day 1 on day 102, day 2 on day 103', () => {
    const fixture = startedFixture()

    expect(run(fixture, onDay(101))).toMatchObject({ status: 'waiting' })
    expect(run(fixture, onDay(102))).toMatchObject({ status: 'ran', events: 1 })
    expect(run(fixture, onDay(103))).toMatchObject({ status: 'ran', events: 1 })
    expect(eventCount(fixture.db)).toBe(102)
  })

  it('runs once a day: the second command the same day does nothing', () => {
    const fixture = startedFixture()
    run(fixture, onDay(102))

    expect(run(fixture, onDay(102, 18))).toEqual({ status: 'skipped', reason: { kind: 'throttled' } })
    expect(run(fixture, onDay(102, 18), { ignoreThrottle: true })).toMatchObject({ status: 'ran', events: 0 })
  })

  it('catches up after days without a run', () => {
    const fixture = startedFixture()

    expect(run(fixture, onDay(104))).toMatchObject({ status: 'ran', events: 3 })
  })

  it('carries on at the next command when its time ran out, instead of calling the day done', () => {
    const fixture = startedFixture()

    const stopped = run(fixture, onDay(104), { isOverBudget: () => true })

    expect(stopped).toMatchObject({ status: 'ran', events: 0, stoppedBecause: 'over-budget' })
    expect(run(fixture, onDay(104))).toMatchObject({ status: 'ran', events: 3, stoppedBecause: 'finished' })
  })

  it('removes the automatic backups older than the limit, forgets their claims, and leaves other files', () => {
    const fixture = startedFixture()
    fs.mkdirSync(fixture.backups)
    const old = path.join(fixture.backups, 'workscribe-3.2.0-old.db')
    const manual = path.join(fixture.backups, 'manual-repair.db')
    for (const file of [old, manual]) {
      fs.writeFileSync(file, 'x')
      fs.utimesSync(file, onDay(1), onDay(1))
    }
    setMetaValue(fixture.db, 'backup:3.2.0', JSON.stringify({ state: 'done', at: 'x', path: old }))

    usedRegularly(fixture, 149)
    const outcome = run(fixture, onDay(150))

    expect(outcome).toMatchObject({ status: 'ran', backupsRemoved: 1 })
    expect(fs.readdirSync(fixture.backups)).toEqual(['manual-repair.db'])
    expect(getMetaValue(fixture.db, 'backup:3.2.0')).toBeNull()
  })

  it('asks for the file cleanup, doing the VACUUM only when it may', () => {
    const fixture = startedFixture()

    expect(run(fixture, onDay(102), { canVacuum: false })).toMatchObject({ cleanup: 'waiting-for-vacuum' })
    expect(run(fixture, onDay(103), { canVacuum: true })).toMatchObject({ cleanup: 'clean' })
    expect(run(fixture, onDay(104), { canVacuum: false })).toMatchObject({ cleanup: 'clean' })
  })
})

describe('runRetention: reminders before the first removal (WOR-179)', () => {
  /** Told on day 200 with events from days 1 to 5, so the first removal is on day 214 (200 + 14). */
  function announcedFixture(): Setup {
    const fixture = setup()
    for (let day = 1; day <= 5; day++) {
      insertEvent(fixture.db, onDay(day, 9))
      insertEvent(fixture.db, onDay(day, 15))
    }
    run(fixture, onDay(200))
    return fixture
  }
  const reminderOn = (fixture: Setup, day: number) => {
    const outcome = run(fixture, onDay(day))
    return outcome.status === 'waiting' ? outcome.reminder : 'not waiting'
  }

  it('says what the first removal takes: the days with events, and how many events', () => {
    const fixture = setup()
    for (let day = 1; day <= 5; day++) insertEvent(fixture.db, onDay(day))
    insertEvent(fixture.db, onDay(5, 15))

    expect(run(fixture, onDay(200))).toMatchObject({ status: 'announced', preview: { eventDays: 5, events: 6 } })
  })

  it('counts the announcement as the 14 day reminder, then reminds at 10, 5 and 1 days, once each', () => {
    const fixture = announcedFixture()

    expect(reminderOn(fixture, 201)).toBeNull()
    expect(reminderOn(fixture, 203)).toBeNull()
    expect(reminderOn(fixture, 204)).toEqual({ eventDays: 5, events: 10 })
    expect(reminderOn(fixture, 204)).toBeNull()
    expect(reminderOn(fixture, 205)).toBeNull()
    expect(reminderOn(fixture, 209)).toEqual({ eventDays: 5, events: 10 })
    expect(reminderOn(fixture, 210)).toBeNull()
    expect(reminderOn(fixture, 213)).toEqual({ eventDays: 5, events: 10 })
    expect(reminderOn(fixture, 213)).toBeNull()
  })

  it('shows one reminder, not several, when days went by without a command', () => {
    const fixture = announcedFixture()

    expect(reminderOn(fixture, 212)).toEqual({ eventDays: 5, events: 10 })
    expect(reminderOn(fixture, 212)).toBeNull()
    expect(reminderOn(fixture, 213)).toEqual({ eventDays: 5, events: 10 })
  })

  it('never reminds again once the removal has started', () => {
    const fixture = announcedFixture()
    reminderOn(fixture, 213)
    // Work captured today, as there would be: removal counts from the newest event, never from the clock alone
    insertEvent(fixture.db, onDay(214))

    expect(run(fixture, onDay(214))).toMatchObject({ status: 'ran', events: 10 })
    expect(run(fixture, onDay(215))).toMatchObject({ status: 'ran' })
  })

  it('reminds a fresh install 14 days before day 102, when the first day goes', () => {
    const fixture = setup()
    insertEvent(fixture.db, onDay(1))
    run(fixture, onDay(1))

    expect(reminderOn(fixture, 87)).toBeNull()
    expect(reminderOn(fixture, 88)).toEqual({ eventDays: 1, events: 1 })
    expect(reminderOn(fixture, 92)).toEqual({ eventDays: 1, events: 1 })
  })
})

describe('runRetention: summaries have a limit of their own (WOR-179)', () => {
  const withSummaryDays = (summaryDays: number | null) => ({
    policy: { ...POLICY, retention: { days: LIMIT_DAYS, keepForever: false, summaryDays } },
  })

  function started(): Setup {
    const fixture = setup()
    insertEvent(fixture.db, onDay(1))
    for (const [index, day] of ['2026-11-23', '2027-01-01', '2027-04-01'].entries()) {
      fixture.db
        .prepare(
          `INSERT INTO summary (scope, engine, text, created_at, source_key, origin, anchor_source, day)
           VALUES ('session', 'skill', 'text', '2027-05-01T10:00:00.000Z', ?, 'saved', 'thread', ?)`
        )
        .run(`api|${index}`, day)
    }
    run(fixture, onDay(1, 10), withSummaryDays(150))
    return fixture
  }

  const summaryDays = (fixture: Setup) =>
    fixture.db.prepare('SELECT day FROM summary ORDER BY day').all() as { day: string }[]

  it('keeps every summary when there is no limit for them, however old', () => {
    const fixture = started()

    run(fixture, onDay(400), withSummaryDays(null))

    expect(summaryDays(fixture)).toHaveLength(3)
  })

  it('removes the summaries of days older than its own limit when removal runs', () => {
    const fixture = started()
    insertEvent(fixture.db, onDay(500))
    usedRegularly(fixture, 499)

    // Day 500 is 2028-04-06; 150 days before it is 2027-11-08, so all three days of summaries are older
    const outcome = run(fixture, onDay(500), withSummaryDays(150))

    expect(outcome).toMatchObject({ status: 'ran', summaries: 3 })
    expect(summaryDays(fixture)).toEqual([])
  })

  it("keeps the newer ones, and the events' limit is a separate one", () => {
    const fixture = started()

    usedRegularly(fixture, 149)
    const outcome = run(fixture, onDay(150), withSummaryDays(150))

    expect(outcome).toMatchObject({ status: 'ran', summaries: 0 })
    expect(summaryDays(fixture)).toHaveLength(3)
  })

  it('waits for the grace like everything else: nothing is removed on the announcing run', () => {
    const fixture = setup()
    fixture.db
      .prepare(
        `INSERT INTO summary (scope, engine, text, created_at, source_key, origin, anchor_source, day)
         VALUES ('session', 'skill', 'text', '2026-01-01T10:00:00.000Z', 'api|1', 'saved', 'thread', '2026-01-01')`
      )
      .run()

    expect(run(fixture, onDay(300), withSummaryDays(150))).toMatchObject({ status: 'announced' })
    expect(summaryDays(fixture)).toHaveLength(1)
  })
})

describe('runRetention: a config that lost the limits (WOR-179)', () => {
  const customised = { ...POLICY, retention: { ...POLICY.retention, days: 365 } }
  const lost = { ...POLICY, isDefault: true }

  function startedWith(policy: typeof POLICY): Setup {
    const fixture = setup()
    for (let day = 1; day <= 400; day++) insertEvent(fixture.db, onDay(day))
    run(fixture, onDay(1, 10), { policy })
    return fixture
  }

  it('removes nothing when the config now says nothing and Workscribe last saw a longer limit, and says what to do', () => {
    const fixture = startedWith(customised)

    const outcome = run(fixture, onDay(400), { policy: lost })

    expect(outcome).toMatchObject({ status: 'skipped', reason: { kind: 'unreadable' } })
    expect(JSON.stringify(outcome)).toContain('workscribe config set retention.days 365')
    expect(eventCount(fixture.db)).toBe(400)
  })

  it('removes as before when the config still states the limits', () => {
    const fixture = startedWith(customised)

    usedRegularly(fixture, 399)

    expect(run(fixture, onDay(400), { policy: customised })).toMatchObject({ status: 'ran', events: 34 })
  })

  it('treats the defaults as what the person has when they were what Workscribe saw', () => {
    const fixture = startedWith(lost)

    usedRegularly(fixture, 399)

    expect(run(fixture, onDay(400), { policy: lost })).toMatchObject({ status: 'ran' })
  })

  it('also protects a summary limit that was lost', () => {
    const fixture = startedWith({ ...customised, retention: { ...customised.retention, summaryDays: 500 } })

    expect(run(fixture, onDay(400), { policy: lost })).toMatchObject({ status: 'skipped' })
  })
})

describe('runRetention: a clock that jumps (WOR-179)', () => {
  function startedFixture(): Setup {
    const fixture = setup()
    for (let day = 1; day <= 120; day++) insertEvent(fixture.db, onDay(day))
    run(fixture, onDay(1, 10))
    usedRegularly(fixture)
    return fixture
  }

  it('removes only what was due by the last thing captured, when the clock is far ahead of it', () => {
    const fixture = startedFixture()

    // A year later by the clock, with nothing captured since day 120
    usedRegularly(fixture, 499)
    const outcome = run(fixture, onDay(500))

    expect(outcome).toMatchObject({ status: 'ran', events: 20 })
    expect(eventCount(fixture.db)).toBe(100)
  })

  it('takes the old backups no further than that either', () => {
    const fixture = startedFixture()
    fs.mkdirSync(fixture.backups)
    const recent = path.join(fixture.backups, 'workscribe-3.5.2-recent.db')
    fs.writeFileSync(recent, 'x')
    fs.utimesSync(recent, onDay(100), onDay(100))

    run(fixture, onDay(500))

    expect(fs.existsSync(recent)).toBe(true)
  })

  it('counts from the clock when work was captured today, so a normal day is not delayed', () => {
    const fixture = startedFixture()
    usedRegularly(fixture, 129)
    insertEvent(fixture.db, onDay(130))

    expect(run(fixture, onDay(130))).toMatchObject({ status: 'ran', events: 29 })
  })

  it('does nothing for a clock that runs behind', () => {
    const fixture = startedFixture()

    expect(run(fixture, onDay(50))).toMatchObject({ status: 'waiting' })
    expect(eventCount(fixture.db)).toBe(120)
  })
})

describe('runRetention: someone away longer than the grace period (WOR-179)', () => {
  function startedFixture(): Setup {
    const fixture = setup()
    for (let day = 1; day <= 130; day++) insertEvent(fixture.db, onDay(day))
    run(fixture, onDay(1, 10))
    return fixture
  }

  it('announces again instead of removing what came due while away, with a new grace and new reminders', () => {
    const fixture = startedFixture()

    // Back on day 120 after 119 days without a run: day 1 to day 18 are older than the limit
    const outcome = run(fixture, onDay(120))

    expect(outcome).toMatchObject({ status: 'announced', firstRemovalOn: localDateStr(onDay(134)) })
    expect(eventCount(fixture.db)).toBe(130)
    expect(run(fixture, onDay(124))).toMatchObject({ status: 'waiting', daysUntil: 10, reminder: expect.anything() })
  })

  it('removes as usual after that announced date', () => {
    const fixture = startedFixture()
    run(fixture, onDay(120))
    usedRegularly(fixture, 133)

    expect(run(fixture, onDay(134))).toMatchObject({ status: 'ran' })
  })

  it('does not announce again when the gap is the grace period or shorter', () => {
    const fixture = startedFixture()
    usedRegularly(fixture, 120 - GRACE_DAYS)

    expect(run(fixture, onDay(120))).toMatchObject({ status: 'ran' })
  })

  it('does not announce again when nothing is old enough to remove', () => {
    const fixture = setup()
    insertEvent(fixture.db, onDay(1))
    run(fixture, onDay(1, 10))

    expect(run(fixture, onDay(60))).toMatchObject({ status: 'waiting' })
  })

  it('announces again once only: a person who comes back every few weeks is then told, not told again', () => {
    const fixture = startedFixture()
    expect(run(fixture, onDay(120))).toMatchObject({ status: 'announced', firstRemovalOn: localDateStr(onDay(134)) })

    // Back after 20 more days, past the date announced: removal goes ahead
    expect(run(fixture, onDay(140))).toMatchObject({ status: 'ran' })
  })

  it('does not announce again for an absence once removal has started', () => {
    const fixture = startedFixture()
    usedRegularly(fixture, 101)
    run(fixture, onDay(102))

    expect(run(fixture, onDay(130))).toMatchObject({ status: 'ran' })
  })

  it('announces again for a new reason after an absence already did', () => {
    const fixture = startedFixture()
    run(fixture, onDay(120))
    restartAnnouncement(fixture.db)

    expect(run(fixture, onDay(121))).toMatchObject({ status: 'announced' })
    expect(run(fixture, onDay(150))).toMatchObject({ status: 'announced' })
  })
})

describe('runRetention: limits edited in config.json (WOR-179)', () => {
  const policyWith = (days: number, summaryDays: number | null = null) => ({
    ...POLICY,
    retention: { days, keepForever: false, summaryDays },
  })

  function announcedAt(days: number): Setup {
    const fixture = setup()
    for (let day = 1; day <= 250; day++) insertEvent(fixture.db, onDay(day))
    run(fixture, onDay(1, 10), { policy: policyWith(days) })
    return fixture
  }

  it('announces again when the file now holds a shorter limit than the one announced', () => {
    const fixture = announcedAt(200)
    usedRegularly(fixture, 220)

    const outcome = run(fixture, onDay(221), { policy: policyWith(100) })

    expect(outcome).toMatchObject({ status: 'announced', days: 100 })
    expect(eventCount(fixture.db)).toBe(250)
  })

  it('records a longer limit, so a lost config is then measured against it', () => {
    const fixture = announcedAt(100)
    usedRegularly(fixture, 220)
    run(fixture, onDay(221), { policy: policyWith(365) })
    const lost = { ...POLICY, isDefault: true }

    expect(run(fixture, onDay(222), { policy: lost })).toMatchObject({ status: 'skipped' })
  })
})
