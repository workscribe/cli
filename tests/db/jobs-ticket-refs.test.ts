import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { insertEventRecord } from '../../src/db/event-writer'
import { runPendingJobs } from '../../src/db/jobs/runner'
import { requestTicketRelink, ticketRefsJob } from '../../src/db/jobs/ticket-refs'
import { summaryAnchorsJob } from '../../src/db/jobs/summary-anchors'
import { dropOldSessionsJob } from '../../src/db/jobs/drop-old-sessions'
import { getJobRow } from '../../src/db/jobs/store'
import type { DataJob } from '../../src/db/jobs/types'
import type { ProjectRecord } from '../../src/db/dimensions'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const CLI: ProjectRecord = {
  identity: 'remote:github.com/workscribe/cli',
  kind: 'remote',
  name: 'cli',
  root: '/code/cli',
}

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  return db
}

/** An event from before capture linked tickets: its project and branch, but no ticket refs. */
function captureHistory(db: DatabaseSync, event: { branch: string; message?: string }): void {
  insertEventRecord(db, {
    captured_at: '2026-10-28T12:00:00.000Z',
    command: event.message ? `git commit -m "${event.message}"` : 'npm test',
    cwd: '/code/cli',
    exit_code: 0,
    duration_ms: null,
    repo_name: 'cli',
    branch: event.branch,
    category: event.message ? 'shipping' : 'testing',
    metadata: event.message ? JSON.stringify({ message: event.message }) : null,
    source: null,
    file_path: null,
    dimensions: { project: CLI, branch: event.branch, file: null },
  })
}

function run(db: DatabaseSync, jobs: DataJob[] = [ticketRefsJob]) {
  return runPendingJobs(db, jobs, { ensureBackup: () => 'ready', batchSize: 1 })
}

const keys = (db: DatabaseSync) =>
  (db.prepare('SELECT key FROM ticket ORDER BY key').all() as { key: string }[]).map((row) => row.key)

describe('ticket-refs', () => {
  it('links the history to the tickets its branches and commits name, in batches', () => {
    const db = database()
    captureHistory(db, { branch: 'feat/WOR-123-context-file-details' })
    captureHistory(db, { branch: 'main', message: 'WOR-7 tidy the docs' })
    captureHistory(db, { branch: 'main' })

    const [result] = run(db).jobs

    expect(keys(db)).toEqual(['WOR-123', 'WOR-7'])
    expect(result.verification).toMatchObject({
      hasPassed: true,
      checked: 3,
      notes: ['tickets: 2; branch links: 1; commit links: 1'],
    })
  })

  it('re-derives every link with a new pattern once config set restarts it', () => {
    const db = database()
    captureHistory(db, { branch: 'feat/WOR-123-context-file-details', message: 'fix #42' })
    run(db)

    requestTicketRelink(db, '#\\d+')
    expect(getJobRow(db, 'ticket-refs')).toBeNull()
    run(db)

    expect(keys(db)).toEqual(['#42'])
  })

  it('uses the default for an unusable stored pattern rather than failing', () => {
    const db = database()
    captureHistory(db, { branch: 'feat/WOR-5-x' })
    db.prepare("INSERT INTO meta (key, value) VALUES ('tickets:pattern', '(')").run()

    expect(run(db).jobs[0].outcome).toBe('done')
    expect(keys(db)).toEqual(['WOR-5'])
  })

  it('runs before the drop of the old tables on a fresh database, and on one whose drop already ran', () => {
    const fresh = database()
    const order = run(fresh, [summaryAnchorsJob, ticketRefsJob, dropOldSessionsJob]).jobs.map((job) => job.name)

    expect(order).toEqual(['summary-anchors', 'ticket-refs', 'drop-old-sessions'])

    const dropped = database()
    run(dropped, [summaryAnchorsJob, dropOldSessionsJob])
    captureHistory(dropped, { branch: 'feat/WOR-8-y' })
    const later = run(dropped, [summaryAnchorsJob, ticketRefsJob, dropOldSessionsJob]).jobs

    expect(later.map((job) => [job.name, job.outcome])).toEqual([['ticket-refs', 'done']])
    expect(keys(dropped)).toEqual(['WOR-8'])
  })
})
