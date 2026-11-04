import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { runPendingJobs } from '../../src/db/jobs/runner'
import { summaryAnchorsJob } from '../../src/db/jobs/summary-anchors'
import { dropOldSessionsJob, OLD_SUMMARIES_NOT_COPIED, OLD_TABLES } from '../../src/db/jobs/drop-old-sessions'
import { getJobRow } from '../../src/db/jobs/store'
import type { DataJob } from '../../src/db/jobs/types'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

// The old tables as `sqlite_master` lists them, by name
const OLD_TABLES_BY_NAME = [...OLD_TABLES].sort()
const STARTED_AT = '2026-10-28T12:00:00.000Z'

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  return db
}

function run(db: DatabaseSync, jobs: DataJob[] = [summaryAnchorsJob, dropOldSessionsJob]) {
  return runPendingJobs(db, jobs, { ensureBackup: () => 'ready' })
}

function oldTables(db: DatabaseSync): string[] {
  const rows = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${OLD_TABLES.map(() => '?').join(', ')})
       ORDER BY name`
    )
    .all(...OLD_TABLES) as { name: string }[]
  return rows.map((row) => row.name)
}

/** An old session with one event and a saved summary, as a database from before the epic has. */
function insertOldSession(db: DatabaseSync): void {
  const { id: eventId } = db
    .prepare(
      "INSERT INTO events (captured_at, command, cwd, repo_name, category) VALUES (?, 'ls', '/repo', 'api', 'files') RETURNING id"
    )
    .get(STARTED_AT) as { id: number }
  const { id: sessionId } = db
    .prepare(
      "INSERT INTO sessions (date, started_at, ended_at, repo_name, event_count) VALUES ('2026-10-28', ?, ?, 'api', 1) RETURNING id"
    )
    .get(STARTED_AT, STARTED_AT) as { id: number }
  db.prepare('INSERT INTO session_events (session_id, event_id) VALUES (?, ?)').run(sessionId, eventId)
  db.prepare(
    "INSERT INTO session_summaries (session_key, engine, text, created_at) VALUES (?, 'skill', 'what happened', ?)"
  ).run(`api|${STARTED_AT}`, STARTED_AT)
}

function markMappingDone(db: DatabaseSync, hasPassed: boolean): void {
  const verification = { checked: 1, resolved: hasPassed ? 1 : 0, unresolved: 0, hasPassed, notes: [] }
  db.prepare("INSERT INTO data_jobs (name, version, status, verification) VALUES (?, ?, 'done', ?)").run(
    summaryAnchorsJob.name,
    summaryAnchorsJob.version,
    JSON.stringify(verification)
  )
}

describe('drop-old-sessions', () => {
  it('drops the empty old tables of a fresh database straight after the summary mapping', () => {
    const db = database()

    const result = run(db)

    expect(result.jobs.map((job) => [job.name, job.outcome])).toEqual([
      ['summary-anchors', 'done'],
      ['drop-old-sessions', 'done'],
    ])
    expect(oldTables(db)).toEqual([])
    expect(result.jobs[1].verification).toMatchObject({ hasPassed: true, checked: 0 })
  })

  it('drops the old tables once their summaries are copied, keeping every anchored summary', () => {
    const db = database()
    insertOldSession(db)

    const result = run(db)

    expect(oldTables(db)).toEqual([])
    expect(db.prepare('SELECT source_key, text FROM summary').all()).toEqual([
      { source_key: `api|${STARTED_AT}`, text: 'what happened' },
    ])
    expect(result.jobs[1].verification).toMatchObject({
      hasPassed: true,
      checked: 3,
      notes: ['dropped session_events (1 rows)', 'dropped sessions (1 rows)', 'dropped session_summaries (1 rows)'],
    })
    // The events the old sessions grouped stay
    expect(db.prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 1 })
  })

  it('refuses, keeping the tables, while the summary mapping has not run', () => {
    const db = database()
    insertOldSession(db)

    const [result] = run(db, [dropOldSessionsJob]).jobs

    expect(result).toMatchObject({ name: 'drop-old-sessions', outcome: 'failed', error: OLD_SUMMARIES_NOT_COPIED })
    expect(oldTables(db)).toEqual(OLD_TABLES_BY_NAME)
  })

  it("refuses, keeping the tables, when the summary mapping's check failed — and again on every run", () => {
    const db = database()
    insertOldSession(db)
    markMappingDone(db, false)

    run(db, [dropOldSessionsJob])
    const [again] = run(db, [dropOldSessionsJob]).jobs

    expect(again.outcome).toBe('failed')
    expect(getJobRow(db, 'drop-old-sessions')).toMatchObject({ status: 'failed', error: OLD_SUMMARIES_NOT_COPIED })
    expect(oldTables(db)).toEqual(OLD_TABLES_BY_NAME)
  })

  it('finishes after a failed run once the mapping passes, and then has nothing left to do', () => {
    const db = database()
    insertOldSession(db)
    run(db, [dropOldSessionsJob])

    run(db)
    const rerun = run(db)

    expect(oldTables(db)).toEqual([])
    expect(getJobRow(db, 'drop-old-sessions')).toMatchObject({ status: 'done' })
    expect(rerun.jobs).toEqual([])
  })
})
