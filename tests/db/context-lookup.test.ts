import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import {
  findLatestFileSave,
  findLatestProjectEvent,
  getAnchoredSummariesInBlock,
  getProjectNames,
} from '../../src/db/context-lookup'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const CLI = 'remote:github.com/workscribe/cli'

function database(root = '/code/cli'): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  db.prepare("INSERT INTO project (identity, kind, name) VALUES (?, 'remote', 'workscribe/cli')").run(CLI)
  db.prepare('INSERT INTO project_path (project_id, path) VALUES (1, ?)').run(root)
  return db
}

/** A checkout and a second worktree of the same repo, each with a README, and a symlink to the first. */
function checkouts(): { root: string; worktree: string; link: string } {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-checkouts-')))
  onTestFinished(() => fs.rmSync(base, { recursive: true, force: true }))
  const root = path.join(base, 'cli')
  const worktree = path.join(base, 'cli-fix')
  const link = path.join(base, 'link')
  for (const folder of [root, worktree]) {
    fs.mkdirSync(folder)
    fs.writeFileSync(path.join(folder, 'README.md'), '')
  }
  fs.symlinkSync(root, link)
  return { root, worktree, link }
}

/** A save linked to the project's `README.md`, stored under `storedPath`. */
function linkedSave(db: DatabaseSync, storedPath: string, capturedAt: string): number {
  const save = insertEvent(db, capturedAt, { filePath: storedPath, projectId: 1 })
  db.exec("INSERT OR IGNORE INTO file (project_id, relative_path) VALUES (1, 'README.md')")
  db.prepare("INSERT INTO event_file (event_id, file_id, action) VALUES (?, 1, 'save')").run(save)
  return save
}

function insertEvent(db: DatabaseSync, capturedAt: string, fields: { filePath?: string; projectId?: number } = {}) {
  const row = db
    .prepare(
      `INSERT INTO events (captured_at, command, cwd, category, file_path, project_id)
       VALUES (?, 'x', '/code/cli', ?, ?, ?) RETURNING id`
    )
    .get(capturedAt, fields.filePath ? 'code_edit' : 'files', fields.filePath ?? null, fields.projectId ?? null) as {
    id: number
  }
  return row.id
}

describe('context-lookup', () => {
  it("finds a file's latest save by the path it was stored under", () => {
    const db = database()
    insertEvent(db, '2026-10-28T09:00:00.000Z', { filePath: '/code/cli/README.md' })
    const latest = insertEvent(db, '2026-10-28T10:00:00.000Z', { filePath: '/code/cli/README.md' })

    expect(findLatestFileSave(db, '/code/cli/README.md')).toEqual({
      id: latest,
      capturedAt: '2026-10-28T10:00:00.000Z',
    })
  })

  it("finds a save through its project's file when it was stored through a symlink to the same file", () => {
    const { root, link } = checkouts()
    const db = database(root)
    const save = linkedSave(db, path.join(link, 'README.md'), '2026-10-28T11:00:00.000Z')

    expect(findLatestFileSave(db, path.join(root, 'README.md'))).toEqual({
      id: save,
      capturedAt: '2026-10-28T11:00:00.000Z',
    })
  })

  it('never takes a save from another worktree of the same repo, though it is the same project file', () => {
    const { root, worktree } = checkouts()
    const db = database(root)
    db.prepare('INSERT INTO project_path (project_id, path) VALUES (1, ?)').run(worktree)
    linkedSave(db, path.join(root, 'README.md'), '2026-10-28T11:00:00.000Z')

    expect(findLatestFileSave(db, path.join(worktree, 'README.md'))).toBeNull()
  })

  it('finds nothing for a file never saved', () => {
    expect(findLatestFileSave(database(), '/code/cli/README.md')).toBeNull()
  })

  it("finds a project's latest event by its identity", () => {
    const db = database()
    insertEvent(db, '2026-10-28T09:00:00.000Z', { projectId: 1 })
    const latest = insertEvent(db, '2026-10-28T12:00:00.000Z', { projectId: 1 })
    insertEvent(db, '2026-10-28T13:00:00.000Z')

    expect(findLatestProjectEvent(db, CLI)).toEqual({ id: latest, capturedAt: '2026-10-28T12:00:00.000Z' })
    expect(findLatestProjectEvent(db, 'remote:github.com/other/repo')).toBeNull()
  })

  it('names projects as they were stored, owner and all', () => {
    expect(getProjectNames(database(), [1, 99])).toEqual(new Map([[1, 'workscribe/cli']]))
  })

  it("names a project with no name of its own by its events' newest name, else by its checkout's folder", () => {
    const db = database()
    db.exec("INSERT INTO project (identity, kind) VALUES ('remote:github.com/acme/site', 'remote')")
    db.exec("INSERT INTO project (identity, kind) VALUES ('remote:github.com/acme/docs', 'remote')")
    db.exec("INSERT INTO project_path (project_id, path) VALUES (3, '/code/docs-site')")
    db.prepare(
      "INSERT INTO events (captured_at, command, cwd, category, repo_name, project_id) VALUES ('2026-10-28T09:00:00.000Z', 'x', '/code/site', 'files', 'acme/site', 2)"
    ).run()

    expect(getProjectNames(db, [2, 3])).toEqual(
      new Map([
        [2, 'acme/site'],
        [3, 'docs-site'],
      ])
    )
  })

  it('reads the summaries whose range starts among the given events', () => {
    const db = database()
    const insert = db.prepare(
      `INSERT INTO summary (scope, first_event_id, engine, text, created_at, source_key, origin, anchor_source)
       VALUES ('session', ?, 'skill', ?, 'now', ?, 'saved', 'live')`
    )
    insert.run(5, 'in the block', 'a')
    insert.run(9, 'elsewhere', 'b')

    expect(getAnchoredSummariesInBlock(db, [4, 5, 6]).map((row) => row.text)).toEqual(['in the block'])
  })
})
