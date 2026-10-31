import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

// Real SQLite, like detector-database.test.ts: the thread path builds a day under the real lock. The database path
// points at a temp folder before the module loads, so it never opens ~/.workscribe.
const temp = vi.hoisted(async () => {
  const fs = await import('fs')
  const os = await import('os')
  const path = await import('path')
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-context-threads-'))
  return { directory, databasePath: path.join(directory, 'workscribe.db') }
})
vi.mock('../../src/utils/paths', async () => {
  const { directory, databasePath } = await temp
  return { WORKSCRIBE_DIR: directory, DB_PATH: databasePath }
})
vi.mock('../../src/config', () => ({
  readConfig: vi.fn(() => ({ session: { idleTimeout: 30 }, capture: { aiTools: true } })),
}))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))
vi.mock('../../src/config/registry', () => ({ loadAIToolRegistry: vi.fn(() => []) }))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { DatabaseSync } from 'node:sqlite'
import { getDb } from '../../src/db'
import { JOBS } from '../../src/db/jobs'
import { lookUpFileThread, lookUpProjectThread } from '../../src/cli/context-threads'
import { DB_PATH } from '../../src/utils/paths'

// Midday UTC, so the local day is the same in every time zone the tests run in
const at = (minutes: number) => new Date(Date.parse('2026-10-28T12:00:00.000Z') + minutes * 60_000).toISOString()
const README = '/s/workscribe/workscribe-landing-page/README.md'
const CLI = 'remote:github.com/workscribe/cli'

function insertEvent(minutes: number, projectId: number, filePath: string | null = null): void {
  getDb()
    .prepare(
      `INSERT INTO events (captured_at, command, cwd, repo_name, category, file_path, project_id)
       VALUES (?, 'x', '/s/workscribe', ?, ?, ?, ?)`
    )
    .run(at(minutes), projectId === 1 ? 'workscribe/cli' : null, filePath ? 'code_edit' : 'files', filePath, projectId)
}

function markJobsDone(): void {
  for (const job of JOBS) {
    getDb()
      .prepare("INSERT OR REPLACE INTO data_jobs (name, version, status) VALUES (?, ?, 'done')")
      .run(job.name, job.version)
  }
}

if (!fs.realpathSync(path.dirname(DB_PATH)).startsWith(fs.realpathSync(os.tmpdir()))) {
  throw new Error(`context-threads-database.test.ts must use a temp database, not ${DB_PATH}`)
}

beforeEach(() => {
  getDb().exec(`
    DELETE FROM work_block; DELETE FROM activity_slot; DELETE FROM grouping_day; DELETE FROM data_jobs;
    DELETE FROM events; DELETE FROM project;
    INSERT INTO project (id, identity, kind, name) VALUES
      (1, '${CLI}', 'remote', 'workscribe/cli'),
      (2, 'remote:github.com/workscribe/landing-page', 'remote', 'workscribe/landing-page');
  `)
  insertEvent(0, 1)
  insertEvent(5, 1)
  insertEvent(10, 2, README)
  insertEvent(15, 1)
})

afterAll(async () => {
  getDb().close()
  fs.rmSync((await temp).directory, { recursive: true, force: true })
})

describe('the context thread path on a real database', () => {
  it("answers a file's save with its own project's thread, and the projects alongside it", () => {
    markJobsDone()

    const lookup = lookUpFileThread(README)

    if (lookup.kind !== 'found') throw new Error(`expected a thread, got ${JSON.stringify(lookup)}`)
    expect(lookup.answer.context).toMatchObject({
      repoName: 'workscribe/landing-page',
      eventCount: 1,
      startedAt: at(10),
    })
    expect(lookup.answer.context.alongside.map((other) => other.repoName)).toEqual(['workscribe/cli'])
    expect(lookup.answer.events.map((event) => event.file_path)).toEqual([README])
  })

  it("answers a repo with its project's latest thread", () => {
    markJobsDone()

    const lookup = lookUpProjectThread(CLI)

    expect(lookup.kind === 'found' && lookup.answer.context).toMatchObject({
      repoName: 'workscribe/cli',
      eventCount: 3,
    })
  })

  it('falls back, the lock not being why, when the built day has no thread holding the save', () => {
    markJobsDone()
    lookUpFileThread(README)
    getDb().exec('DELETE FROM thread_event WHERE event_id = (SELECT id FROM events WHERE file_path IS NOT NULL)')

    expect(lookUpFileThread(README)).toEqual({ kind: 'fallback', isLocked: false })
  })

  it('falls back to the old sessions until the data upgrade has run', () => {
    expect(lookUpFileThread(README)).toEqual({ kind: 'fallback', isLocked: false })
  })

  it('falls back, saying the lock was why, within the one lock wait', async () => {
    markJobsDone()
    const otherProcess = new DatabaseSync((await temp).databasePath)
    otherProcess.exec('BEGIN IMMEDIATE')
    const startedAt = Date.now()

    let lookup
    try {
      lookup = lookUpFileThread(README)
    } finally {
      otherProcess.exec('ROLLBACK')
      otherProcess.close()
    }

    expect(lookup).toEqual({ kind: 'fallback', isLocked: true })
    expect(Date.now() - startedAt).toBeLessThan(2000)
  })
})
