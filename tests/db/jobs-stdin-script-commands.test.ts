import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { JOBS } from '../../src/db/jobs'
import { runPendingJobs } from '../../src/db/jobs/runner'
import { getJobRow } from '../../src/db/jobs/store'
import { stdinScriptCommandsJob } from '../../src/db/jobs/stdin-script-commands'
import { dropOldSessionsJob } from '../../src/db/jobs/drop-old-sessions'
import { normalizeCommand } from '../../src/normalize/patterns'

// The job normalises stored events the way capture does, which reads the user's config and profiles
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))
vi.mock('../../src/config/registry', () => ({ loadAIToolRegistry: vi.fn(() => []) }))

const SCRIPT = "python3 - <<'PYEOF'\nPYEOF"

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
       VALUES ('2026-10-28T12:00:00.000Z', ?, '/code/cli', ?, 'cli', 'main', ?, ?, 'claude-code')`
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
  return runPendingJobs(db, [stdinScriptCommandsJob], { ensureBackup: () => 'ready' })
}

describe('stdin-script-commands job', () => {
  it.each([
    [SCRIPT, 'running'],
    [`${SCRIPT}\ngrep -n x src/a.ts`, 'running'],
    [`${SCRIPT}\nnpx vitest run`, 'testing'],
    ['cat a.py | python3 -', 'running'],
    ['cd app && python -u - <<EOF\nEOF', 'running'],
    ['python3 -I -', 'running'],
    ["python3 -W ignore - <<'PYEOF'\nPYEOF", 'running'],
  ])('moves %j out of exploring, to what a new capture says', (command, expectedCategory) => {
    const db = database()
    const event = insert(db, { command, category: 'exploring', metadata: '{"tool":"python3"}' })

    runJob(db)

    expect(row(db, event).category).toBe(expectedCategory)
  })

  it('stores what a new capture would, so a rerun of capture and the job agree', () => {
    const db = database()
    const event = insert(db, { command: SCRIPT, category: 'exploring', metadata: '{"tool":"python3"}' })

    runJob(db)

    const { category, metadata } = normalizeCommand(SCRIPT)
    expect(row(db, event).category).toBe(category)
    expect(JSON.parse(row(db, event).metadata ?? '{}')).toEqual(metadata)
  })

  it.each([
    ['python3 -c "print(1)"', 'exploring'],
    ['python3 x.py', 'running'],
    [SCRIPT, 'running'],
    [SCRIPT, 'linting'],
    [SCRIPT, 'testing'],
    [SCRIPT, 'other'],
  ])('leaves %j alone in %s: only an exploring row that runs a script moves', (command, category) => {
    const db = database()
    const event = insert(db, { command, category, metadata: '{"tool":"python3"}' })

    runJob(db)

    expect(row(db, event)).toMatchObject({ category, metadata: '{"tool":"python3"}' })
  })

  it('ignores an exploring row that has no python in it', () => {
    const db = database()
    const event = insert(db, { command: 'node - <<EOF\nEOF', category: 'exploring', metadata: '{"tool":"node"}' })

    runJob(db)

    expect(row(db, event).category).toBe('exploring')
  })

  it('never changes the stored command or exit code', () => {
    const db = database()
    const event = insert(db, { command: SCRIPT, category: 'exploring', exitCode: 1 })

    runJob(db)

    expect(row(db, event)).toMatchObject({ command: SCRIPT, exit_code: 1 })
  })

  it('keeps the other keys of the metadata it replaces the tool in', () => {
    const db = database()
    const event = insert(db, {
      command: SCRIPT,
      category: 'exploring',
      metadata: '{"tool":"python3","tickets":["WOR-1"]}',
    })

    runJob(db)

    expect(JSON.parse(row(db, event).metadata ?? '{}')).toEqual({
      runtime: 'python',
      source: 'stdin',
      tickets: ['WOR-1'],
    })
  })

  it('handles every row across batches, and passes its check', () => {
    const db = database()
    const events = Array.from({ length: 1200 }, () =>
      insert(db, { command: SCRIPT, category: 'exploring', metadata: '{"tool":"python3"}' })
    )

    const result = runJob(db)

    expect(row(db, events[events.length - 1]).category).toBe('running')
    expect(result.jobs.map((job) => job.name)).toEqual([stdinScriptCommandsJob.name])
    expect(getJobRow(db, stdinScriptCommandsJob.name)?.status).toBe('done')
    expect(stdinScriptCommandsJob.verify(db)).toMatchObject({ unresolved: 0, hasPassed: true })
  })

  it('changes nothing when it runs again', () => {
    const db = database()
    const moved = insert(db, { command: SCRIPT, category: 'exploring', metadata: '{"tool":"python3"}' })
    const left = insert(db, { command: 'python3 -c "print(1)"', category: 'exploring', metadata: '{"tool":"python3"}' })
    runJob(db)
    const before = [row(db, moved), row(db, left)]

    stdinScriptCommandsJob.runBatch(db, 0, 100)

    expect([row(db, moved), row(db, left)]).toEqual(before)
  })

  it('is listed before drop-old-sessions, so a stuck check there cannot keep it from running', () => {
    const names = JOBS.map((job) => job.name)

    expect(names).toContain(stdinScriptCommandsJob.name)
    expect(names.indexOf(stdinScriptCommandsJob.name)).toBeLessThan(names.indexOf(dropOldSessionsJob.name))
  })
})
