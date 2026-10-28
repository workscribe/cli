import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { findRecentSessionsForRepo } from '../../src/db/session-lookup'

const ROOT = '/Users/dev/api'

function emptyDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db, MIGRATIONS)
  return db
}

/** A session with one event run in `cwd`; returns the session id. */
function addSession(db: DatabaseSync, options: { repoName: string; startedAt: string; cwd: string }): number {
  const event = db
    .prepare(
      "INSERT INTO events (captured_at, command, cwd, repo_name, category) VALUES ($at, 'npm test', $cwd, $repo, 'testing')"
    )
    .run({ at: options.startedAt, cwd: options.cwd, repo: options.repoName })
  const session = db
    .prepare(
      'INSERT INTO sessions (date, started_at, ended_at, repo_name, event_count) VALUES ($date, $at, $at, $repo, 1)'
    )
    .run({ date: options.startedAt.slice(0, 10), at: options.startedAt, repo: options.repoName })
  db.prepare('INSERT INTO session_events (session_id, event_id) VALUES (?, ?)').run(
    session.lastInsertRowid,
    event.lastInsertRowid
  )
  return Number(session.lastInsertRowid)
}

function startedAts(db: DatabaseSync, otherRepoName: string | null): string[] {
  return findRecentSessionsForRepo(db, { repoName: 'acme/api', otherRepoName, roots: [ROOT] }, 10).map(
    (session) => session.started_at
  )
}

describe('findRecentSessionsForRepo', () => {
  it('finds sessions under the configured name, wherever they ran', () => {
    const db = emptyDatabase()
    addSession(db, { repoName: 'acme/api', startedAt: '2026-10-20T09:00:00.000Z', cwd: '/elsewhere' })

    expect(startedAts(db, 'api')).toEqual(['2026-10-20T09:00:00.000Z'])
  })

  it('finds sessions under the other form when they ran in the repo root or a subfolder, newest first', () => {
    const db = emptyDatabase()
    addSession(db, { repoName: 'api', startedAt: '2026-10-20T09:00:00.000Z', cwd: ROOT })
    addSession(db, { repoName: 'api', startedAt: '2026-10-21T09:00:00.000Z', cwd: `${ROOT}/src` })
    addSession(db, { repoName: 'acme/api', startedAt: '2026-10-22T09:00:00.000Z', cwd: ROOT })

    expect(startedAts(db, 'api')).toEqual([
      '2026-10-22T09:00:00.000Z',
      '2026-10-21T09:00:00.000Z',
      '2026-10-20T09:00:00.000Z',
    ])
  })

  it("ignores another owner's same-named repo, and a sibling folder that only shares the prefix", () => {
    const db = emptyDatabase()
    addSession(db, { repoName: 'api', startedAt: '2026-10-20T09:00:00.000Z', cwd: '/Users/dev/other-org/api' })
    addSession(db, { repoName: 'api', startedAt: '2026-10-21T09:00:00.000Z', cwd: `${ROOT}-old` })

    expect(startedAts(db, 'api')).toEqual([])
  })

  it('returns each session once, even with several events in the repo', () => {
    const db = emptyDatabase()
    const sessionId = addSession(db, { repoName: 'api', startedAt: '2026-10-20T09:00:00.000Z', cwd: ROOT })
    const event = db
      .prepare(
        "INSERT INTO events (captured_at, command, cwd, repo_name, category) VALUES ('2026-10-20T09:05:00.000Z', 'ls', ?, 'api', 'other')"
      )
      .run(`${ROOT}/src`)
    db.prepare('INSERT INTO session_events (session_id, event_id) VALUES (?, ?)').run(sessionId, event.lastInsertRowid)

    expect(startedAts(db, 'api')).toHaveLength(1)
  })

  // As a LIKE pattern, `/Users/dev/ap_/%` would match `/Users/dev/apX/src`
  it('treats % and _ in the repo path literally', () => {
    const db = emptyDatabase()
    addSession(db, { repoName: 'api', startedAt: '2026-10-20T09:00:00.000Z', cwd: '/Users/dev/apX/src' })

    const sessions = findRecentSessionsForRepo(
      db,
      { repoName: 'acme/api', otherRepoName: 'api', roots: ['/Users/dev/ap_'] },
      10
    )
    expect(sessions).toEqual([])
  })

  it('matches only the configured name when there is no other form', () => {
    const db = emptyDatabase()
    addSession(db, { repoName: 'api', startedAt: '2026-10-20T09:00:00.000Z', cwd: ROOT })

    expect(startedAts(db, null)).toEqual([])
  })
})

describe('findRecentSessionsForRepo — a repo reached through a symlink', () => {
  it('matches activity stored under any form of the root, and nothing outside them', () => {
    const db = emptyDatabase()
    addSession(db, { repoName: 'api', startedAt: '2026-10-20T09:00:00.000Z', cwd: '/Users/dev/link/api/src' })
    addSession(db, { repoName: 'api', startedAt: '2026-10-21T09:00:00.000Z', cwd: ROOT })
    addSession(db, { repoName: 'api', startedAt: '2026-10-22T09:00:00.000Z', cwd: '/Users/dev/link/other' })

    const sessions = findRecentSessionsForRepo(
      db,
      { repoName: 'acme/api', otherRepoName: 'api', roots: [ROOT, '/Users/dev/link/api'] },
      10
    )

    expect(sessions.map((session) => session.started_at)).toEqual([
      '2026-10-21T09:00:00.000Z',
      '2026-10-20T09:00:00.000Z',
    ])
  })

  it('matches nothing under the other form with no roots at all', () => {
    const db = emptyDatabase()
    addSession(db, { repoName: 'api', startedAt: '2026-10-20T09:00:00.000Z', cwd: ROOT })

    expect(findRecentSessionsForRepo(db, { repoName: 'acme/api', otherRepoName: 'api', roots: [] }, 10)).toEqual([])
  })
})
