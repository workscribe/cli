import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { insertEventRecord, type NewEvent } from '../../src/db/event-writer'
import type { EventDimensions, ProjectRecord } from '../../src/db/dimensions'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const API: ProjectRecord = { identity: 'remote:github.com/acme/api', kind: 'remote', name: 'api', root: '/code/api' }

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  return db
}

function event(overrides: Partial<NewEvent> = {}): NewEvent {
  return {
    captured_at: '2026-10-30T09:00:00.000Z',
    command: 'git status',
    cwd: '/code/api',
    exit_code: 0,
    duration_ms: null,
    repo_name: 'api',
    branch: 'main',
    category: 'versioning',
    metadata: null,
    source: null,
    file_path: null,
    ...overrides,
  }
}

function linked(project: ProjectRecord, overrides: Partial<EventDimensions> = {}): EventDimensions {
  return { project, branch: 'main', file: null, ...overrides }
}

const rows = (db: DatabaseSync, sql: string) => db.prepare(sql).all()

describe('insertEventRecord', () => {
  it('stores the text columns as given and links the event to its project and branch', () => {
    const db = database()

    insertEventRecord(db, event({ dimensions: linked(API) }))

    expect(rows(db, 'SELECT repo_name, branch, project_id, branch_id FROM events')).toEqual([
      { repo_name: 'api', branch: 'main', project_id: 1, branch_id: 1 },
    ])
    expect(rows(db, 'SELECT identity, kind, name FROM project')).toEqual([
      { identity: 'remote:github.com/acme/api', kind: 'remote', name: 'api' },
    ])
  })

  it('keeps one project for both name forms, with each name as an alias and the latest as its name', () => {
    const db = database()

    insertEventRecord(db, event({ dimensions: linked(API) }))
    insertEventRecord(db, event({ repo_name: 'acme/api', dimensions: linked({ ...API, name: 'acme/api' }) }))

    expect(rows(db, 'SELECT DISTINCT project_id FROM events')).toEqual([{ project_id: 1 }])
    expect(rows(db, 'SELECT name FROM project_alias ORDER BY name')).toEqual([{ name: 'acme/api' }, { name: 'api' }])
    expect(rows(db, 'SELECT name FROM project')).toEqual([{ name: 'acme/api' }])
  })

  it('records every worktree root of one project', () => {
    const db = database()

    insertEventRecord(db, event({ dimensions: linked(API) }))
    insertEventRecord(db, event({ cwd: '/code/api-fix', dimensions: linked({ ...API, root: '/code/api-fix' }) }))

    expect(rows(db, 'SELECT project_id, path FROM project_path ORDER BY path')).toEqual([
      { project_id: 1, path: '/code/api' },
      { project_id: 1, path: '/code/api-fix' },
    ])
  })

  it('links a save to its file, relative to the project root', () => {
    const db = database()

    insertEventRecord(
      db,
      event({
        category: 'code_edit',
        file_path: '/code/api/src/index.ts',
        dimensions: linked(API, { file: { relativePath: 'src/index.ts', action: 'save' } }),
      })
    )

    expect(
      rows(
        db,
        'SELECT event_file.event_id, file.relative_path, event_file.action FROM event_file JOIN file ON file.id = file_id'
      )
    ).toEqual([{ event_id: 1, relative_path: 'src/index.ts', action: 'save' }])
  })

  it('stores the event without links when linking fails, rather than losing it', () => {
    const db = database()
    db.exec('DROP TABLE event_file')

    insertEventRecord(
      db,
      event({ dimensions: linked(API, { file: { relativePath: 'src/index.ts', action: 'save' } }) })
    )

    expect(rows(db, 'SELECT command, project_id FROM events')).toEqual([{ command: 'git status', project_id: null }])
    expect(rows(db, 'SELECT * FROM project')).toEqual([])
  })

  it('stores an event with no project as before', () => {
    const db = database()

    insertEventRecord(db, event({ repo_name: null, branch: null, dimensions: linked(API, { project: null }) }))

    expect(rows(db, 'SELECT project_id, branch_id FROM events')).toEqual([{ project_id: null, branch_id: null }])
  })
})
