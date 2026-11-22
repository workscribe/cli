import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { JOBS } from '../../src/db/jobs'
import { runPendingJobs } from '../../src/db/jobs/runner'
import { getJobRow } from '../../src/db/jobs/store'
import { npxFlagCommandsJob } from '../../src/db/jobs/npx-flag-commands'
import { dropOldSessionsJob } from '../../src/db/jobs/drop-old-sessions'
import { normalizeCommand } from '../../src/normalize/patterns'

// The job normalises stored events the way capture does, which reads the user's config and profiles
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))
vi.mock('../../src/config/registry', () => ({ loadAIToolRegistry: vi.fn(() => []) }))

interface StoredEvent {
  command: string
  category: string
  metadata?: string | null
  exitCode?: number | null
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
       VALUES ('2026-10-28T12:00:00.000Z', ?, '/code/cli', ?, 'cli', 'main', ?, ?, 'zsh')`
    )
    .run(event.command, event.exitCode === undefined ? 0 : event.exitCode, event.category, event.metadata ?? null)
  return Number(result.lastInsertRowid)
}

interface StoredRow {
  category: string
  metadata: string | null
  command: string
  exit_code: number | null
}

function row(db: DatabaseSync, id: number): StoredRow {
  return db
    .prepare('SELECT category, metadata, command, exit_code FROM events WHERE id = ?')
    .get(id) as unknown as StoredRow
}

function runJob(db: DatabaseSync) {
  return runPendingJobs(db, [npxFlagCommandsJob], { ensureBackup: () => 'ready' })
}

describe('npx-flag-commands job', () => {
  it.each([
    ['npx --no-install vitest run', 'testing', 'vitest'],
    ['npx --no-install eslint src', 'linting', 'eslint'],
    ['npx -y prettier --check .', 'linting', 'prettier'],
    ['npx --no-install tsc --noEmit', 'building', 'tsc'],
    ['cd app && npx --no-install vitest run 2>&1 | tail -5', 'testing', 'vitest'],
  ])('moves %s out of running', (command, expectedCategory, expectedTool) => {
    const db = database()
    const event = insert(db, { command, category: 'running', metadata: '{"tool":"--no-install"}' })

    runJob(db)

    expect(row(db, event).category).toBe(expectedCategory)
    expect(JSON.parse(row(db, event).metadata ?? '{}')).toEqual({ tool: expectedTool })
  })

  it('stores what a new capture would, so a rerun of capture and the job agree', () => {
    const db = database()
    const command = 'npx --no-install vitest run tests/a.test.ts'
    const event = insert(db, { command, category: 'running', metadata: '{"tool":"--no-install"}' })

    runJob(db)

    const { category, metadata } = normalizeCommand(command)
    expect(row(db, event).category).toBe(category)
    expect(JSON.parse(row(db, event).metadata ?? '{}')).toEqual(metadata)
  })

  it.each([
    ['npx -p typescript tsc --noEmit', 'running'],
    ['npx --yes create-next-app my-app', 'running'],
    ['npx --no-install vitest run', 'testing'],
    ['npx --no-install eslint src', 'shipping'],
    ['npx --no-install eslint src', 'other'],
  ])('leaves %s alone in %s: only rows that still read as running move', (command, category) => {
    const db = database()
    const event = insert(db, { command, category, metadata: '{"tool":"x"}' })

    runJob(db)

    expect(row(db, event).category).toBe(category)
    expect(row(db, event).metadata).toBe('{"tool":"x"}')
  })

  it('ignores a running row without an npx flag', () => {
    const db = database()
    const event = insert(db, { command: 'node scripts/build.js', category: 'running', metadata: '{"runtime":"node"}' })

    runJob(db)

    expect(row(db, event)).toMatchObject({ category: 'running', metadata: '{"runtime":"node"}' })
  })

  it('never changes the stored command or exit code', () => {
    const db = database()
    const event = insert(db, { command: 'npx --no-install vitest run | tail', category: 'running', exitCode: 1 })

    runJob(db)

    expect(row(db, event)).toMatchObject({ command: 'npx --no-install vitest run | tail', exit_code: 1 })
  })

  it('keeps the other keys of the metadata it replaces the tool in', () => {
    const db = database()
    const event = insert(db, {
      command: 'npx --no-install eslint src',
      category: 'running',
      metadata: '{"tool":"--no-install","tickets":["WOR-1"]}',
    })

    runJob(db)

    expect(JSON.parse(row(db, event).metadata ?? '{}')).toEqual({ tool: 'eslint', tickets: ['WOR-1'] })
  })

  it('handles every row across batches, and passes its check', () => {
    const db = database()
    const events = Array.from({ length: 1200 }, () =>
      insert(db, { command: 'npx --no-install tsc --noEmit', category: 'running', metadata: '{"tool":"--no-install"}' })
    )

    const result = runJob(db)

    expect(row(db, events[events.length - 1]).category).toBe('building')
    expect(result.jobs.map((job) => job.name)).toEqual([npxFlagCommandsJob.name])
    expect(getJobRow(db, npxFlagCommandsJob.name)?.status).toBe('done')
    expect(npxFlagCommandsJob.verify(db)).toMatchObject({ unresolved: 0, hasPassed: true })
  })

  it('changes nothing when it runs again', () => {
    const db = database()
    const moved = insert(db, {
      command: 'npx --no-install eslint src',
      category: 'running',
      metadata: '{"tool":"--no-install"}',
    })
    const left = insert(db, { command: 'npx -p a b', category: 'running', metadata: '{"tool":"-p"}' })
    runJob(db)
    const before = [row(db, moved), row(db, left)]

    npxFlagCommandsJob.runBatch(db, 0, 100)

    expect([row(db, moved), row(db, left)]).toEqual(before)
  })

  it('is listed before drop-old-sessions, so a stuck check there cannot keep it from running', () => {
    const names = JOBS.map((job) => job.name)

    expect(names).toContain(npxFlagCommandsJob.name)
    expect(names.indexOf(npxFlagCommandsJob.name)).toBeLessThan(names.indexOf(dropOldSessionsJob.name))
  })
})
