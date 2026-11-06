import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { runPendingJobs, type RunOptions } from '../../src/db/jobs/runner'
import { readDataStatus } from '../../src/db/jobs/state'
import { getJobRow, startJob } from '../../src/db/jobs/store'
import type { DataJob } from '../../src/db/jobs/types'
import type { MigrationDatabase } from '../../src/db/migration-types'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const FIXED_TIME = new Date('2026-10-29T12:00:00.000Z')

function migratedDatabase(file = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(file)
  applyMigrations(db, MIGRATIONS)
  db.exec('CREATE TABLE IF NOT EXISTS copied (event_id INTEGER PRIMARY KEY, job_version INTEGER NOT NULL)')
  return db
}

const CAPTURE_INSERT =
  "INSERT INTO events (captured_at, command, cwd, category) VALUES ('2026-10-29T12:00:00.000Z', 'pwd', '/repo', 'files')"

/** A WAL database file with a second connection standing in for a capture, which gives up on a lock after 100 ms. */
function databaseWithCapture(): { db: DatabaseSync; capture: DatabaseSync } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-jobs-'))
  const file = path.join(directory, 'workscribe.db')
  const db = migratedDatabase(file)
  db.exec('PRAGMA journal_mode = WAL')
  const capture = new DatabaseSync(file)
  capture.exec('PRAGMA busy_timeout = 100')
  onTestFinished(() => {
    db.close()
    capture.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return { db, capture }
}

function insertEvents(db: DatabaseSync, count: number): void {
  const insert = db.prepare(
    "INSERT INTO events (captured_at, command, cwd, category) VALUES ('2026-10-28T12:00:00.000Z', 'ls', '/repo', 'files')"
  )
  for (let index = 0; index < count; index++) insert.run()
}

/** Copies event ids into `copied`, reports odd ids as unresolved, and can be made to throw on a given batch. */
function copyJob(overrides: Partial<DataJob> & { failOnBatch?: number } = {}): DataJob {
  let batches = 0
  const version = overrides.version ?? 1
  return {
    name: 'copy-events',
    version,
    description: 'Copy event ids',
    prepare: (db: MigrationDatabase) => db.exec('DELETE FROM copied'),
    runBatch: (db: MigrationDatabase, afterId: number, limit: number) => {
      batches += 1
      if (batches === overrides.failOnBatch) throw new Error('disk on fire')
      const rows = db.prepare('SELECT id FROM events WHERE id > ? ORDER BY id LIMIT ?').all(afterId, limit) as {
        id: number
      }[]
      const insert = db.prepare('INSERT OR REPLACE INTO copied (event_id, job_version) VALUES (?, ?)')
      for (const row of rows) insert.run(row.id, version)
      return {
        lastId: rows.at(-1)?.id ?? null,
        issues: rows.filter((row) => row.id % 2 === 1).map((row) => ({ reference: `event:${row.id}`, reason: 'odd' })),
      }
    },
    verify: (db: MigrationDatabase) => {
      const { events } = db.prepare('SELECT COUNT(*) AS events FROM events').get() as { events: number }
      const { copied } = db.prepare('SELECT COUNT(*) AS copied FROM copied').get() as { copied: number }
      return { checked: events, resolved: copied, unresolved: 0, hasPassed: events === copied, notes: [] }
    },
    ...overrides,
  }
}

function run(db: DatabaseSync, jobs: DataJob[], options: Partial<RunOptions> = {}) {
  return runPendingJobs(db, jobs, { ensureBackup: () => 'ready', batchSize: 2, now: () => FIXED_TIME, ...options })
}

function copiedIds(db: DatabaseSync): number[] {
  return (db.prepare('SELECT event_id FROM copied ORDER BY event_id').all() as { event_id: number }[]).map(
    (row) => row.event_id
  )
}

function issueCount(db: DatabaseSync): number {
  return (db.prepare('SELECT COUNT(*) AS count FROM data_job_issues').get() as { count: number }).count
}

describe('runPendingJobs', () => {
  it('runs a pending job to the end in batches and stores its verification', () => {
    const db = migratedDatabase()
    insertEvents(db, 5)

    const result = run(db, [copyJob()])

    expect(result.backup).toBe('ready')
    expect(result.jobs).toEqual([
      expect.objectContaining({
        name: 'copy-events',
        outcome: 'done',
        verification: expect.objectContaining({ hasPassed: true }),
      }),
    ])
    expect(copiedIds(db)).toEqual([1, 2, 3, 4, 5])
    expect(getJobRow(db, 'copy-events')).toEqual(expect.objectContaining({ status: 'done', cursor: 5 }))
  })

  it('records the rows a job could not resolve', () => {
    const db = migratedDatabase()
    insertEvents(db, 5)

    run(db, [copyJob()])

    const references = db.prepare('SELECT reference FROM data_job_issues ORDER BY id').all() as { reference: string }[]
    expect(references.map((row) => row.reference)).toEqual(['event:1', 'event:3', 'event:5'])
  })

  it('does nothing, and asks for no backup, when every job is done', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)
    run(db, [copyJob()])
    const ensureBackup = vi.fn(() => 'ready' as const)

    const result = run(db, [copyJob()], { ensureBackup })

    expect(result).toEqual({ backup: 'not-needed', jobs: [] })
    expect(ensureBackup).not.toHaveBeenCalled()
  })

  it('runs nothing when there is no backup', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)

    const result = run(db, [copyJob()], { ensureBackup: () => 'unavailable' })

    expect(result).toEqual({ backup: 'unavailable', jobs: [] })
    expect(copiedIds(db)).toEqual([])
    expect(getJobRow(db, 'copy-events')).toBeNull()
  })

  it('resumes after a failed batch and ends as an uninterrupted run would', () => {
    const interrupted = migratedDatabase()
    const uninterrupted = migratedDatabase()
    insertEvents(interrupted, 7)
    insertEvents(uninterrupted, 7)

    const failed = run(interrupted, [copyJob({ failOnBatch: 3 })])
    expect(failed.jobs[0]).toEqual(expect.objectContaining({ outcome: 'failed', error: 'disk on fire' }))
    expect(getJobRow(interrupted, 'copy-events')).toEqual(expect.objectContaining({ status: 'failed', cursor: 4 }))

    run(interrupted, [copyJob()])
    run(uninterrupted, [copyJob()])

    expect(copiedIds(interrupted)).toEqual(copiedIds(uninterrupted))
    expect(issueCount(interrupted)).toBe(issueCount(uninterrupted))
    expect(getJobRow(interrupted, 'copy-events')?.status).toBe('done')
  })

  it('reruns a job over every row when its version is bumped, keeping earlier issues', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)
    run(db, [copyJob()])
    const prepare = vi.fn((database: MigrationDatabase) => database.exec('DELETE FROM copied'))

    run(db, [copyJob({ version: 2, prepare })])

    expect(prepare).toHaveBeenCalledTimes(1)
    const versions = db.prepare('SELECT DISTINCT job_version FROM copied').all() as { job_version: number }[]
    expect(versions).toEqual([{ job_version: 2 }])
    expect(issueCount(db)).toBe(4) // events 1 and 3, once per version
  })

  it('passes on a busy backup and runs nothing', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)

    expect(run(db, [copyJob()], { ensureBackup: () => 'busy' })).toEqual({ backup: 'busy', jobs: [] })
    expect(copiedIds(db)).toEqual([])
  })

  it('leaves a job a newer version started and did not finish, rather than finishing it with older code', () => {
    const db = migratedDatabase()
    insertEvents(db, 5)
    run(db, [copyJob({ version: 2, failOnBatch: 2 })])
    const olderRunBatch = vi.fn()

    const result = run(db, [copyJob({ version: 1, runBatch: olderRunBatch })])

    expect(result.jobs[0]).toEqual(
      expect.objectContaining({ outcome: 'paused', error: expect.stringContaining('newer version') })
    )
    expect(olderRunBatch).not.toHaveBeenCalled()
    expect(getJobRow(db, 'copy-events')).toEqual(expect.objectContaining({ version: 2, status: 'failed' }))
  })

  it('stops partway when a newer version takes the job over mid-run, and never marks it done', () => {
    const db = migratedDatabase()
    insertEvents(db, 6)
    const newer = copyJob({ version: 2 })
    let hasTakenOver = false

    // After the first batch, a newer CLI restarts the job at version 2 (as its startJob would)
    const result = run(db, [copyJob({ version: 1 })], {
      onProgress: () => {
        if (hasTakenOver) return
        hasTakenOver = true
        startJob(db, newer, FIXED_TIME.toISOString())
      },
    })

    expect(result.jobs[0]).toEqual(
      expect.objectContaining({ outcome: 'paused', error: expect.stringContaining('newer version') })
    )
    expect(getJobRow(db, 'copy-events')).toEqual(expect.objectContaining({ version: 2, status: 'running', cursor: 0 }))
    expect(copiedIds(db)).toEqual([])
  })

  it('records a job that fails before its first write as failed, not pending', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)
    const broken = copyJob({
      prepare: () => {
        throw new Error('bad prepare')
      },
    })

    const result = run(db, [broken])

    expect(result.jobs[0]).toEqual(expect.objectContaining({ outcome: 'failed', error: 'bad prepare' }))
    expect(getJobRow(db, 'copy-events')).toEqual(
      expect.objectContaining({ status: 'failed', error: 'bad prepare', version: 1 })
    )
    expect(readDataStatus(db, [broken]).failed).toEqual({ name: 'copy-events', error: 'bad prepare' })
  })

  it('never runs a job backwards when a newer version already finished it', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)
    run(db, [copyJob({ version: 2 })])

    const result = run(db, [copyJob({ version: 1 })])

    expect(result.backup).toBe('not-needed')
  })

  it('stops between batches once the budget is spent, and carries on next time', () => {
    const db = migratedDatabase()
    insertEvents(db, 6)
    let clock = FIXED_TIME.getTime()
    const now = () => {
      clock += 600
      return new Date(clock)
    }

    const first = run(db, [copyJob()], { budgetMs: 1000, now })

    expect(first.jobs[0].outcome).toBe('paused')
    expect(copiedIds(db).length).toBeLessThan(6)

    run(db, [copyJob()])
    expect(copiedIds(db)).toEqual([1, 2, 3, 4, 5, 6])
  })

  it('stops at the first job that does not finish, so later jobs can rely on earlier ones', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)
    const later = copyJob({ name: 'later' })

    const result = run(db, [copyJob({ failOnBatch: 1 }), later])

    expect(result.jobs.map((job) => job.name)).toEqual(['copy-events'])
    expect(getJobRow(db, 'later')).toBeNull()
  })

  it('reports progress after each batch', () => {
    const db = migratedDatabase()
    insertEvents(db, 4)
    const onProgress = vi.fn()

    run(db, [copyJob()], { onProgress })

    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ job: expect.objectContaining({ name: 'copy-events' }) })
    )
  })

  it('lets another process write while the job checks its work', () => {
    const { db, capture } = databaseWithCapture()
    insertEvents(db, 3)
    let captureError: unknown = null

    run(db, [
      copyJob({
        verify: (database: MigrationDatabase) => {
          try {
            capture.prepare(CAPTURE_INSERT).run()
          } catch (error) {
            captureError = error
          }
          return copyJob().verify(database)
        },
      }),
    ])

    expect(captureError).toBeNull()
  })

  it('lets another process write between batches', () => {
    const { db, capture } = databaseWithCapture()
    insertEvents(db, 6)
    let hasCaptured = false

    // One capture after the first batch — the second connection must get the lock while the job is mid-run
    run(db, [copyJob()], {
      onProgress: () => {
        if (hasCaptured) return
        hasCaptured = true
        capture.prepare(CAPTURE_INSERT).run()
      },
    })

    const { count } = capture.prepare("SELECT COUNT(*) AS count FROM events WHERE command = 'pwd'").get() as {
      count: number
    }
    expect(count).toBeGreaterThan(0)
  })
})

describe('runPendingJobs — cleanup', () => {
  /** A cleanup that's pending until it has run `succeedOnAttempt` times, throwing before that. */
  function cleanupOf({ succeedOnAttempt = 1 } = {}) {
    let attempts = 0
    const run = vi.fn(() => {
      attempts += 1
      if (attempts < succeedOnAttempt) throw new Error('database is locked')
    })
    return { isPending: () => attempts < succeedOnAttempt, run }
  }

  it('runs once the job is done, outside any transaction', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)
    const cleanup = cleanupOf()
    cleanup.run.mockImplementationOnce(() => {
      expect(getJobRow(db, 'copy-events')?.status).toBe('done')
      db.exec('BEGIN')
      db.exec('COMMIT')
    })

    const result = run(db, [copyJob({ cleanup })])

    expect(result.jobs[0].outcome).toBe('done')
    expect(cleanup.run).toHaveBeenCalledOnce()
  })

  it('does not run while the job is paused', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)
    const cleanup = cleanupOf()

    expect(run(db, [copyJob({ cleanup })], { budgetMs: 0 }).jobs[0].outcome).toBe('paused')
    expect(cleanup.run).not.toHaveBeenCalled()
  })

  it('never fails a job that is done, and tries again on the next run though no job is pending', () => {
    const db = migratedDatabase()
    insertEvents(db, 1)
    const cleanup = cleanupOf({ succeedOnAttempt: 2 })
    const job = copyJob({ cleanup })

    const first = run(db, [job])
    expect(first.jobs[0].outcome).toBe('done')
    expect(getJobRow(db, 'copy-events')?.status).toBe('done')
    expect(cleanup.run).toHaveBeenCalledTimes(1)

    expect(run(db, [job])).toEqual({ backup: 'not-needed', jobs: [] })
    expect(cleanup.run).toHaveBeenCalledTimes(2)

    run(db, [job])
    expect(cleanup.run).toHaveBeenCalledTimes(2)
  })
})

describe('readDataStatus', () => {
  it('lists pending jobs before they run', () => {
    const db = migratedDatabase()

    expect(readDataStatus(db, [copyJob()])).toEqual({
      pending: ['copy-events'],
      failed: null,
      failedChecks: [],
      unresolvedRows: 0,
      latestBackup: null,
    })
  })

  it('reports a failed job with its error', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)
    run(db, [copyJob({ failOnBatch: 1 })])

    expect(readDataStatus(db, [copyJob()]).failed).toEqual({ name: 'copy-events', error: 'disk on fire' })
  })

  it('reports the last verification and the latest finished backup once done', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)
    run(db, [copyJob()])
    db.prepare('INSERT INTO meta (key, value) VALUES (?, ?), (?, ?), (?, ?)').run(
      'backup:2.1.0',
      JSON.stringify({ state: 'done', at: '2026-10-01T00:00:00.000Z', path: '/backups/old.db' }),
      'backup:2.2.0',
      JSON.stringify({ state: 'done', at: '2026-10-29T00:00:00.000Z', path: '/backups/new.db' }),
      'backup:2.3.0',
      JSON.stringify({ state: 'claimed', at: '2026-10-30T00:00:00.000Z' })
    )

    const status = readDataStatus(db, [copyJob()])

    expect(status.pending).toEqual([])
    expect(status.failedChecks).toEqual([])
    expect(status.latestBackup).toBe('/backups/new.db')
  })

  it('totals unresolved rows across every finished job', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)
    const withUnresolved = (name: string, unresolved: number) =>
      copyJob({
        name,
        verify: () => ({ checked: 3, resolved: 3 - unresolved, unresolved, hasPassed: true, notes: [] }),
      })
    const jobs = [withUnresolved('first', 2), withUnresolved('second', 1)]
    run(db, jobs)

    expect(readDataStatus(db, jobs).unresolvedRows).toBe(3)
  })

  it('keeps reporting a job whose check failed after it is done', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)
    const lossy = copyJob({
      verify: () => ({ checked: 3, resolved: 2, unresolved: 0, hasPassed: false, notes: [] }),
    })
    run(db, [lossy])

    const status = readDataStatus(db, [lossy])

    expect(status.pending).toEqual([])
    expect(status.failedChecks).toEqual(['copy-events'])
  })
})

describe('runPendingJobs — gather', () => {
  /** Whether the connection is inside a transaction: BEGIN fails there. */
  function isInTransaction(db: MigrationDatabase): boolean {
    try {
      db.exec('BEGIN')
      db.exec('ROLLBACK')
      return false
    } catch {
      return true
    }
  }

  it('gathers outside any transaction, after the job started, before its first batch', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)
    const seen: { status: string | undefined; isInTransaction: boolean; copied: number }[] = []
    const job = copyJob({
      gather: (database) => {
        seen.push({
          status: getJobRow(database, 'copy-events')?.status,
          isInTransaction: isInTransaction(database),
          copied: copiedIds(db).length,
        })
        return 'complete'
      },
    })

    expect(run(db, [job]).jobs).toEqual([expect.objectContaining({ outcome: 'done' })])
    expect(seen).toEqual([{ status: 'running', isInTransaction: false, copied: 0 }])
  })

  it('pauses the job, with nothing run, when gathering is incomplete — and carries on next run', () => {
    const db = migratedDatabase()
    insertEvents(db, 3)
    const gather = vi.fn().mockReturnValueOnce('incomplete').mockReturnValue('complete')
    const job = copyJob({ gather })

    expect(run(db, [job]).jobs).toEqual([expect.objectContaining({ outcome: 'paused' })])
    expect(copiedIds(db)).toEqual([])
    expect(readDataStatus(db, [job]).pending).toEqual(['copy-events'])

    expect(run(db, [job]).jobs).toEqual([expect.objectContaining({ outcome: 'done' })])
    expect(gather).toHaveBeenCalledTimes(2)
  })

  it('records a failure when gathering throws', () => {
    const db = migratedDatabase()
    insertEvents(db, 1)
    const job = copyJob({
      gather: () => {
        throw new Error('git is gone')
      },
    })

    expect(run(db, [job]).jobs).toEqual([expect.objectContaining({ outcome: 'failed', error: 'git is gone' })])
    expect(getJobRow(db, 'copy-events')).toEqual(expect.objectContaining({ status: 'failed' }))
  })

  it('never gathers for a job a newer version owns', () => {
    const db = migratedDatabase()
    insertEvents(db, 1)
    startJob(db, copyJob({ version: 2 }), FIXED_TIME.toISOString())
    const gather = vi.fn(() => 'complete' as const)

    run(db, [copyJob({ gather })])

    expect(gather).not.toHaveBeenCalled()
  })
})
