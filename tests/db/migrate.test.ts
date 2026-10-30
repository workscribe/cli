import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real normalizer runs inside migration 006 — keep it off the user's config, profiles and AI-tool registry
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))
vi.mock('../../src/config/registry', () => ({
  loadAIToolRegistry: vi.fn(() => [
    { tool: 'claude', displayName: 'Claude Code', pattern: '^claude\\b', hook: 'claude-code', contextSource: 'hook' },
  ]),
}))
vi.mock('../../src/normalize/patterns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/normalize/patterns')>()
  return { ...actual, normalizeCommand: vi.fn(actual.normalizeCommand) }
})

import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { normalizeCommand } from '../../src/normalize/patterns'
import { readConfig } from '../../src/config'
import type { Migration } from '../../src/db/migration-types'

const BEFORE_RECLASSIFY = MIGRATIONS.filter((migration) => migration.version < 6)

interface StoredEvent {
  id: number
  command: string
  category: string
  metadata: string | null
}

function databaseAtVersion5(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db, BEFORE_RECLASSIFY)
  return db
}

function insertEvent(db: DatabaseSync, command: string, category: string, metadata: string | null): void {
  db.prepare(
    "INSERT INTO events (captured_at, command, cwd, category, metadata) VALUES ('2026-10-22T09:00:00.000Z', ?, '/repo', ?, ?)"
  ).run(command, category, metadata)
}

const events = (db: DatabaseSync): StoredEvent[] =>
  db.prepare('SELECT id, command, category, metadata FROM events ORDER BY id').all() as unknown as StoredEvent[]

const versions = (db: DatabaseSync): number[] =>
  (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map(
    (row) => row.version
  )

beforeEach(() => {
  vi.mocked(readConfig).mockReturnValue({ capture: { aiTools: true } } as ReturnType<typeof readConfig>)
})

describe('applyMigrations', () => {
  it('builds a fresh database through every migration', () => {
    const db = new DatabaseSync(':memory:')

    applyMigrations(db, MIGRATIONS)

    expect(versions(db)).toEqual(MIGRATIONS.map((migration) => migration.version))
  })

  it('records version 1 for a database from before migrations existed', () => {
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE events (id INTEGER PRIMARY KEY)')
    const markerOnly: Migration = {
      version: 1,
      description: 'would fail on an existing table',
      sql: 'CREATE TABLE events (id INTEGER)',
    }

    applyMigrations(db, [markerOnly])

    expect(versions(db)).toEqual([1])
  })

  it('rolls back a failing migration and does not record it', () => {
    const db = databaseAtVersion5()
    const broken: Migration = {
      version: 99,
      description: 'broken',
      sql: "UPDATE events SET category = 'x'; SELECT * FROM missing_table;",
    }
    insertEvent(db, 'npm test', 'testing', null)

    expect(() => applyMigrations(db, [...BEFORE_RECLASSIFY, broken])).toThrow('Migration 99 (broken) failed')

    expect(versions(db)).not.toContain(99)
    expect(events(db)[0].category).toBe('testing')
  })
})

describe('migration 006 — reclassify unclassified events', () => {
  it('reclassifies only other rows, replacing their metadata and leaving every command untouched', () => {
    const db = databaseAtVersion5()
    insertEvent(
      db,
      'cd app && pnpm nx test shell 2>&1 | tail -40',
      'other',
      '{"tool":"cd","hint":"cd app && pnpm nx test"}'
    )
    insertEvent(db, 'gh run view 123', 'other', '{"tool":"gh","hint":"gh run view 123"}')
    insertEvent(db, 'git status', 'versioning', '{"subcommand":"status"}')

    applyMigrations(db, MIGRATIONS)

    expect(events(db)).toEqual([
      expect.objectContaining({
        command: 'cd app && pnpm nx test shell 2>&1 | tail -40',
        category: 'testing',
        metadata: '{"tool":"nx","target":"test"}',
      }),
      expect.objectContaining({
        command: 'gh run view 123',
        category: 'other',
        metadata: '{"tool":"gh","hint":"gh run view 123"}',
      }),
      expect.objectContaining({ command: 'git status', category: 'versioning', metadata: '{"subcommand":"status"}' }),
    ])
    expect(versions(db)).toContain(6)
  })

  it('skips a row it cannot classify and still updates the rest', () => {
    const db = databaseAtVersion5()
    insertEvent(db, 'weird command', 'other', null)
    insertEvent(db, 'cd app && npm test', 'other', null)
    vi.mocked(normalizeCommand).mockImplementationOnce(() => {
      throw new Error('unexpected input')
    })

    applyMigrations(db, MIGRATIONS)

    expect(events(db).map((event) => event.category)).toEqual(['other', 'testing'])
    expect(versions(db)).toContain(6)
  })

  it('creates no AI sessions when capture.aiTools is off', () => {
    vi.mocked(readConfig).mockReturnValue({ capture: { aiTools: false } } as ReturnType<typeof readConfig>)
    const db = databaseAtVersion5()
    insertEvent(db, 'cd app && claude', 'other', null)

    applyMigrations(db, MIGRATIONS)

    expect(events(db)[0].category).toBe('other')
  })
})

describe('applyMigrations — another process got there first', () => {
  it('skips a migration that was applied between its first check and taking the write lock', () => {
    const executed: string[] = []
    let versionChecks = 0
    const run = vi.fn()
    const db = {
      exec: (sql: string) => executed.push(sql.trim()),
      prepare: (sql: string) => ({
        get: () => {
          if (!sql.includes('WHERE version = ?')) return undefined
          versionChecks += 1
          return versionChecks === 1 ? undefined : { version: 7 } // applied by the time we hold the lock
        },
        all: () => [],
        run: () => undefined,
      }),
    }

    applyMigrations(db, [{ version: 7, description: 'raced', sql: 'SELECT 1', run }])

    expect(run).not.toHaveBeenCalled()
    expect(executed).toEqual(expect.arrayContaining(['BEGIN IMMEDIATE', 'COMMIT']))
    expect(executed).not.toContain('SELECT 1')
  })
})

describe('applyMigrations — the data_jobs migration', () => {
  const dataJobsMigration = MIGRATIONS.find((migration) => migration.description.startsWith('Add data job state'))

  function tables(db: DatabaseSync): string[] {
    return (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (row) => row.name
    )
  }

  it('only adds tables, keeping every stored event', () => {
    const db = new DatabaseSync(':memory:')
    applyMigrations(
      db,
      MIGRATIONS.filter((migration) => migration.version < (dataJobsMigration?.version ?? 0))
    )
    insertEvent(db, 'git status', 'versioning', null)

    applyMigrations(db, MIGRATIONS)

    expect(tables(db)).toEqual(expect.arrayContaining(['data_jobs', 'data_job_issues', 'meta']))
    expect(events(db)).toHaveLength(1)
  })

  it('is safe to run again on a database that already has its tables', () => {
    const db = new DatabaseSync(':memory:')
    applyMigrations(db, MIGRATIONS)

    expect(() => db.exec(dataJobsMigration?.sql ?? '')).not.toThrow()
  })
})

describe('applyMigrations — the dimensions migration', () => {
  const dimensionsMigration = MIGRATIONS.find((migration) => migration.description.startsWith('Add project, branch'))

  it('only adds tables and nullable columns, keeping every stored event as it was', () => {
    const db = new DatabaseSync(':memory:')
    applyMigrations(
      db,
      MIGRATIONS.filter((migration) => migration.version < (dimensionsMigration?.version ?? 0))
    )
    insertEvent(db, 'git status', 'versioning', null)
    const before = events(db)

    applyMigrations(db, MIGRATIONS)

    expect(events(db)).toEqual(before)
    expect(db.prepare('SELECT project_id, branch_id FROM events').all()).toEqual([
      { project_id: null, branch_id: null },
    ])
    const tableNames = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]
    ).map((row) => row.name)
    expect(tableNames).toEqual(
      expect.arrayContaining(['project', 'project_alias', 'project_path', 'branch', 'file', 'event_file'])
    )
  })

  it('applies once: running the migrations again changes nothing', () => {
    const db = new DatabaseSync(':memory:')
    applyMigrations(db, MIGRATIONS)

    expect(() => applyMigrations(db, MIGRATIONS)).not.toThrow()
    expect(versions(db)).toEqual(MIGRATIONS.map((migration) => migration.version))
  })
})
