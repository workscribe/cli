import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { runPendingJobs, type RunOptions } from '../../src/db/jobs/runner'
import { summaryAnchorsJob } from '../../src/db/jobs/summary-anchors'
import { getSummaryBySource, saveSummaryToBothStores } from '../../src/db/summary-store'
import type { DataJob } from '../../src/db/jobs/types'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

// Midday UTC, so the local day is the same in every time zone the tests run in
const at = (minutes: number) => new Date(Date.parse('2026-10-28T12:00:00.000Z') + minutes * 60_000).toISOString()

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  for (let index = 1; index <= 3; index++) {
    db.prepare("INSERT INTO project (identity, kind) VALUES (?, 'remote')").run(`remote:host/p${index}`)
  }
  return db
}

function insertEvent(db: DatabaseSync, minutes: number, repoName: string | null, projectId: number | null): number {
  const row = db
    .prepare(
      "INSERT INTO events (captured_at, command, cwd, repo_name, category, project_id) VALUES (?, 'ls', '/repo', ?, 'files', ?) RETURNING id"
    )
    .get(at(minutes), repoName, projectId) as { id: number }
  return row.id
}

/** A cached old session, named and keyed like the detector makes them, with its summary. */
function sessionWithSummary(db: DatabaseSync, repoName: string | null, eventIds: number[], engine = 'legacy'): string {
  const [first, last] = [eventIds[0], eventIds[eventIds.length - 1]].map(
    (id) => (db.prepare('SELECT captured_at FROM events WHERE id = ?').get(id) as { captured_at: string }).captured_at
  )
  const { id } = db
    .prepare(
      "INSERT INTO sessions (date, started_at, ended_at, repo_name, event_count) VALUES ('2026-10-28', ?, ?, ?, ?) RETURNING id"
    )
    .get(first, last, repoName, eventIds.length) as { id: number }
  for (const eventId of eventIds) db.prepare('INSERT INTO session_events VALUES (?, ?)').run(id, eventId)
  const key = `${repoName ?? ''}|${first}`
  summaryFor(db, key, engine)
  return key
}

function summaryFor(db: DatabaseSync, key: string, engine = 'legacy'): void {
  db.prepare("INSERT INTO session_summaries VALUES (?, ?, 'what happened', '2026-10-28T20:00:00.000Z')").run(
    key,
    engine
  )
}

function run(db: DatabaseSync, job: DataJob = summaryAnchorsJob, options: Partial<RunOptions> = {}) {
  return runPendingJobs(db, [job], { ensureBackup: () => 'ready', batchSize: 1, ...options })
}

const issues = (db: DatabaseSync) =>
  db.prepare('SELECT reference, reason FROM data_job_issues ORDER BY id').all() as {
    reference: string
    reason: string
  }[]

const summaries = (db: DatabaseSync) =>
  db.prepare('SELECT source_key, project_id, first_event_id, last_event_id, origin FROM summary ORDER BY id').all()

describe('the summary-anchors job', () => {
  it("anchors a cached session's summary to its project and events, with nothing to report", () => {
    const db = database()
    const key = sessionWithSummary(db, 'api', [insertEvent(db, 0, 'api', 1), insertEvent(db, 5, 'api', 1)])

    const [result] = run(db).jobs

    expect(getSummaryBySource(db, key, 'legacy')).toMatchObject({
      project_id: 1,
      first_event_id: 1,
      last_event_id: 2,
      text: 'what happened',
      created_at: '2026-10-28T20:00:00.000Z',
      origin: 'mapped',
    })
    expect(issues(db)).toEqual([])
    expect(result.verification).toMatchObject({ checked: 1, resolved: 1, unresolved: 0, hasPassed: true })
  })

  it('reports a summary whose session mixed projects — the shape of session 183', () => {
    const db = database()
    const ids = [insertEvent(db, 0, 'cli', 1), insertEvent(db, 1, 'cli', 1), insertEvent(db, 2, 'cli', 1)]
    const key = sessionWithSummary(db, 'landing-page', [...ids, insertEvent(db, 3, 'landing-page', 2)])

    run(db)

    expect(getSummaryBySource(db, key, 'legacy')).toMatchObject({ project_id: 2 })
    expect(issues(db)).toEqual([
      {
        reference: `${key} (legacy)`,
        reason: 'the session mixed projects: its own project held 25% of its events, so the summary matches no thread',
      },
    ])
  })

  it('regroups the day with the frozen rules when the session is no longer cached, and says so', () => {
    const db = database()
    insertEvent(db, 0, 'api', 1)
    insertEvent(db, 5, 'api', 1)
    insertEvent(db, 120, 'api', 1)
    const key = `api|${at(0)}`
    summaryFor(db, key)

    run(db)

    expect(getSummaryBySource(db, key, 'legacy')).toMatchObject({ first_event_id: 1, last_event_id: 2 })
    expect(issues(db).map((issue) => issue.reason)).toEqual([
      'the session was no longer cached; its range comes from regrouping its day with the default 30-minute idle timeout',
    ])
  })

  it('keeps a summary whose events are gone, without a range, and reports it', () => {
    const db = database()
    const key = `api|${at(0)}`
    summaryFor(db, key)

    const [result] = run(db).jobs

    expect(getSummaryBySource(db, key, 'legacy')).toMatchObject({ first_event_id: null, project_id: null })
    expect(issues(db).map((issue) => issue.reason)).toEqual([
      'no events match this session any more; the summary is kept without a range',
    ])
    expect(result.verification).toMatchObject({ checked: 1, resolved: 0, unresolved: 1, hasPassed: true })
  })

  it("reports a session whose events aren't linked to a project yet", () => {
    const db = database()
    sessionWithSummary(db, 'api', [insertEvent(db, 0, 'api', null)])

    run(db)

    expect(issues(db).map((issue) => issue.reason)).toEqual(["the session's events aren't linked to a project yet"])
  })

  it('keeps the range of a summary saved by the agent skill, filling in only its missing project', () => {
    const db = database()
    const ids = [insertEvent(db, 0, 'api', 1), insertEvent(db, 5, 'api', 1)]
    const key = sessionWithSummary(db, 'api', ids, 'skill')
    saveSummaryToBothStores(db, {
      sourceKey: key,
      engine: 'skill',
      text: 'written by the skill',
      createdAt: '2026-10-28T21:00:00.000Z',
      anchor: { projectId: null, firstEventId: 2, lastEventId: 2, isMixed: false },
      anchorSource: 'live',
    })

    run(db)
    run(db, { ...summaryAnchorsJob, version: 2 })

    expect(getSummaryBySource(db, key, 'skill')).toMatchObject({
      origin: 'saved',
      text: 'written by the skill',
      first_event_id: 2,
      last_event_id: 2,
      project_id: 1,
    })
  })

  it('ends with the same rows after an interrupted run, and a version bump never duplicates them', () => {
    const clean = database()
    const db = database()
    for (const target of [clean, db]) {
      sessionWithSummary(target, 'api', [insertEvent(target, 0, 'api', 1)])
      sessionWithSummary(target, 'web', [insertEvent(target, 40, 'web', 2)])
      summaryFor(target, `gone|${at(500)}`)
    }
    run(clean)
    let batches = 0
    const flaky: DataJob = {
      ...summaryAnchorsJob,
      runBatch: (database, afterId, limit) => {
        batches += 1
        if (batches === 2) throw new Error('disk on fire')
        return summaryAnchorsJob.runBatch(database, afterId, limit)
      },
    }

    run(db, flaky)
    run(db, flaky)
    run(db, { ...summaryAnchorsJob, version: 2 })

    expect(summaries(db)).toEqual(summaries(clean))
    expect(db.prepare('SELECT COUNT(*) AS count FROM summary').get()).toEqual({ count: 3 })
  })

  it('counts the summaries from each source, and the ones whose session mixed projects', () => {
    const db = database()
    sessionWithSummary(db, 'api', [insertEvent(db, 0, 'api', 1)])
    const mixed = [insertEvent(db, 40, 'cli', 1), insertEvent(db, 41, 'cli', 1), insertEvent(db, 42, 'web', 2)]
    sessionWithSummary(db, 'web', mixed)
    summaryFor(db, `gone|${at(500)}`)

    const [result] = run(db).jobs

    expect(result.verification?.notes).toEqual([
      "2 from the old session's cached events",
      '1 kept without a range (their events are gone)',
      '1 described a session that mixed projects, so they match no thread',
    ])
  })

  it('never changes the old store', () => {
    const db = database()
    sessionWithSummary(db, 'api', [insertEvent(db, 0, 'api', 1)])
    const before = db.prepare('SELECT * FROM session_summaries').all()

    run(db)

    expect(db.prepare('SELECT * FROM session_summaries').all()).toEqual(before)
  })
})
