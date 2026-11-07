import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { JOBS } from '../../src/db/jobs'
import { runPendingJobs } from '../../src/db/jobs/runner'
import { getJobRow } from '../../src/db/jobs/store'
import { dropOldSessionsJob } from '../../src/db/jobs/drop-old-sessions'
import { movedMetadata, readOnlyCommandsJob } from '../../src/db/jobs/read-only-commands'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

interface StoredEvent {
  command: string
  category: string
  metadata?: string | null
}

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  return db
}

function insert(db: DatabaseSync, event: StoredEvent): number {
  const result = db
    .prepare(
      `INSERT INTO events (captured_at, command, cwd, exit_code, repo_name, branch, category, metadata, source)
       VALUES ('2026-10-28T12:00:00.000Z', ?, '/code/cli', 0, 'cli', 'main', ?, ?, 'zsh')`
    )
    .run(event.command, event.category, event.metadata ?? null)
  return Number(result.lastInsertRowid)
}

function row(db: DatabaseSync, id: number): { category: string; metadata: string | null; command: string } {
  return db.prepare('SELECT category, metadata, command FROM events WHERE id = ?').get(id) as {
    category: string
    metadata: string | null
    command: string
  }
}

function runJob(db: DatabaseSync) {
  return runPendingJobs(db, [readOnlyCommandsJob], { ensureBackup: () => 'ready' })
}

describe('read-only-commands job', () => {
  it.each([
    ['git log --oneline', 'versioning'],
    ['ls src', 'other'],
    ['sed -n 1p f', 'files'],
    ['python3 -c "print(1)"', 'running'],
  ])('moves %s from %s', (command, category) => {
    const db = database()
    const event = insert(db, { command, category })
    runJob(db)
    expect(row(db, event).category).toBe('exploring')
  })

  it.each([
    ['git status', 'testing'],
    ['git status', 'shipping'],
    ['cat f', 'linting'],
    ['ls', 'note'],
  ])('leaves %s in %s, which these rules never changed', (command, category) => {
    const db = database()
    const event = insert(db, { command, category })
    runJob(db)
    expect(row(db, event).category).toBe(category)
  })

  it.each([
    ['git add .', 'versioning'],
    ['grep x f && ./deploy.sh', 'other'],
    ['sed -i s/a/b/ f', 'files'],
    ['python3 x.py', 'running'],
    ['cat f | xargs rm', 'other'],
  ])('leaves %s, which does more than read', (command, category) => {
    const db = database()
    const event = insert(db, { command, category })
    runJob(db)
    expect(row(db, event).category).toBe(category)
  })

  it('never moves a row out of exploring', () => {
    const db = database()
    const event = insert(db, { command: 'grep x f && ./deploy.sh', category: 'exploring' })
    runJob(db)
    expect(row(db, event).category).toBe('exploring')
  })

  it('never changes the stored command', () => {
    const db = database()
    const event = insert(db, { command: 'git log  --oneline', category: 'versioning' })
    runJob(db)
    expect(row(db, event).command).toBe('git log  --oneline')
  })

  it('handles every row across batches, and passes its check', () => {
    const db = database()
    const events = Array.from({ length: 1200 }, () => insert(db, { command: 'git status', category: 'versioning' }))
    const result = runJob(db)
    expect(row(db, events[events.length - 1]).category).toBe('exploring')
    expect(result.jobs.map((job) => job.name)).toEqual([readOnlyCommandsJob.name])
    expect(getJobRow(db, readOnlyCommandsJob.name)?.status).toBe('done')
    expect(readOnlyCommandsJob.verify(db)).toMatchObject({ unresolved: 0, hasPassed: true })
  })

  it('changes nothing when it runs again', () => {
    const db = database()
    const moved = insert(db, { command: 'git status', category: 'versioning', metadata: '{"subcommand":"status"}' })
    const left = insert(db, { command: './deploy.sh', category: 'other', metadata: '{"hint":"./deploy.sh"}' })
    runJob(db)
    const before = [row(db, moved), row(db, left)]

    readOnlyCommandsJob.runBatch(db, 0, 100)

    expect([row(db, moved), row(db, left)]).toEqual(before)
  })

  it('runs ahead of drop-old-sessions, and on a database where that job is already done', () => {
    const names = JOBS.map((job) => job.name)
    expect(names.indexOf(readOnlyCommandsJob.name)).toBe(names.indexOf(dropOldSessionsJob.name) - 1)

    const db = database()
    db.prepare(
      `INSERT INTO data_jobs (name, version, cursor, status, started_at)
       VALUES (?, ?, 0, 'done', '2026-10-28T12:00:00.000Z')`
    ).run(dropOldSessionsJob.name, dropOldSessionsJob.version)
    const event = insert(db, { command: 'git status', category: 'versioning' })

    const result = runPendingJobs(db, [readOnlyCommandsJob, dropOldSessionsJob], { ensureBackup: () => 'ready' })

    expect(result.jobs.map((job) => job.name)).toEqual([readOnlyCommandsJob.name])
    expect(row(db, event).category).toBe('exploring')
  })
})

describe('movedMetadata', () => {
  it('drops a stale hint and tool, and stores what a new capture would', () => {
    const metadata = JSON.stringify({ hint: 'ls src', tool: 'npx' })
    expect(JSON.parse(movedMetadata({ command: 'ls src', metadata }))).toEqual({ tool: 'ls' })
  })

  it('keeps everything else', () => {
    const metadata = JSON.stringify({ subcommand: 'old', prompt: 'kept', hint: 'x' })
    expect(JSON.parse(movedMetadata({ command: 'git log', metadata }))).toEqual({ subcommand: 'log', prompt: 'kept' })
  })

  it('fills in metadata for a row that has none', () => {
    expect(JSON.parse(movedMetadata({ command: 'git status', metadata: null }))).toEqual({ subcommand: 'status' })
  })

  it.each(['not json', '[1,2]', 'null'])('leaves %s as it is', (metadata) => {
    expect(movedMetadata({ command: 'ls', metadata })).toBe(metadata)
  })
})
