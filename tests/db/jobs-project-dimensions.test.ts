import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { runPendingJobs, type RunOptions } from '../../src/db/jobs/runner'
import { createProjectDimensionsJob } from '../../src/db/jobs/project-dimensions'
import type { DirectoryProbe } from '../../src/capture/git'
import type { DataJob } from '../../src/db/jobs/types'
import { linkEventFile, upsertFile, upsertProject } from '../../src/db/dimensions'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const CLI_ROOT = '/s/workscribe/workscribe-cli'
const SITE_ROOT = '/s/workscribe/workscribe-landing-page'
const CLI = 'remote:github.com/workscribe/cli'
const SITE = 'remote:github.com/workscribe/landing-page'

const repo = (root: string, remoteUrl: string | null): DirectoryProbe => ({
  outcome: 'repo',
  root,
  commonDir: `${root}/.git`,
  remoteUrl,
})

/** What git says today about the folders in the fixture — the shape of a real database where repos moved. */
const PROBES: Record<string, DirectoryProbe> = {
  [CLI_ROOT]: repo(CLI_ROOT, 'git@github.com:workscribe/cli.git'),
  [`${CLI_ROOT}/docs`]: repo(CLI_ROOT, 'git@github.com:workscribe/cli.git'),
  [SITE_ROOT]: repo(SITE_ROOT, 'https://github.com/workscribe/landing-page.git'),
  '/s/workscribe': { outcome: 'not-a-repo' },
  '/home': { outcome: 'not-a-repo' },
}

function fakeProbe(probes: Record<string, DirectoryProbe> = PROBES) {
  return vi.fn((directory: string): DirectoryProbe => probes[directory] ?? { outcome: 'missing' })
}

interface FixtureEvent {
  cwd: string
  repo: string | null
  branch?: string | null
  file?: string
}

/** Old events, as captured before capture linked them. */
const HISTORY: FixtureEvent[] = [
  { cwd: '/s/chronicle', repo: 'cli', branch: 'feat/WOR-6' },
  { cwd: '/s/chronicle', repo: 'cli', branch: 'feat/WOR-6' },
  { cwd: '/users/s/chronicle', repo: 'cli' },
  { cwd: CLI_ROOT, repo: 'cli', branch: 'main' },
  { cwd: CLI_ROOT, repo: 'workscribe/cli', branch: 'main' },
  { cwd: `${CLI_ROOT}/docs`, repo: 'workscribe/cli', branch: 'main' },
  { cwd: '/s/workscribe-landing-page', repo: 'landing-page', branch: 'main' },
  { cwd: SITE_ROOT, repo: 'landing-page', branch: 'main' },
  { cwd: '/s/workscribe-profiles', repo: 'profiles' },
  { cwd: '/s/workscribe', repo: null },
  { cwd: '/s/workscribe', repo: null, file: `${SITE_ROOT}/README.md` },
  { cwd: '/home', repo: null, file: '/home/.zshrc' },
]

function database(events: FixtureEvent[] = HISTORY): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  for (const event of events) insertEvent(db, event)
  return db
}

function insertEvent(db: DatabaseSync, event: FixtureEvent, projectId: number | null = null): void {
  db.prepare(
    `INSERT INTO events (captured_at, command, cwd, repo_name, branch, category, file_path, project_id)
     VALUES ('2026-10-28T12:00:00.000Z', 'ls', ?, ?, ?, ?, ?, ?)`
  ).run(event.cwd, event.repo, event.branch ?? null, event.file ? 'code_edit' : 'files', event.file ?? null, projectId)
}

function run(db: DatabaseSync, job: DataJob, options: Partial<RunOptions> = {}) {
  return runPendingJobs(db, [job], { ensureBackup: () => 'ready', batchSize: 3, ...options })
}

interface LinkedEvent {
  id: number
  cwd: string
  repo_name: string | null
  identity: string | null
  branch: string | null
}

function linkedEvents(db: DatabaseSync): LinkedEvent[] {
  return db
    .prepare(
      `SELECT events.id, events.cwd, events.repo_name, project.identity, branch.name AS branch FROM events
       LEFT JOIN project ON project.id = events.project_id LEFT JOIN branch ON branch.id = events.branch_id
       ORDER BY events.id`
    )
    .all() as unknown as LinkedEvent[]
}

const identities = (db: DatabaseSync) => linkedEvents(db).map((event) => event.identity)

function issues(db: DatabaseSync): { reference: string; reason: string }[] {
  return db.prepare('SELECT reference, reason FROM data_job_issues ORDER BY id').all() as {
    reference: string
    reason: string
  }[]
}

describe('the project-dimensions job', () => {
  it('links moved, renamed and live history of one repo to one project', () => {
    const db = database()

    const result = run(db, createProjectDimensionsJob({ probeDirectory: fakeProbe() }))

    expect(result.jobs).toEqual([expect.objectContaining({ outcome: 'done' })])
    expect(identities(db)).toEqual([
      CLI, // chronicle is gone, but the live repo was also stored as bare `cli`
      CLI,
      CLI, // the lower-case copy of the gone folder
      CLI,
      CLI,
      CLI, // a subfolder of the live checkout
      SITE,
      SITE,
      'name:profiles', // gone, and no live repo matches
      null, // captured outside a repo
      SITE, // a save of a file in the site, from a workspace above it
      null, // a save of a file in no repo
    ])
  })

  it('keeps each branch under its own project, and none for a save from another folder', () => {
    const db = database()

    run(db, createProjectDimensionsJob({ probeDirectory: fakeProbe() }))

    const branches = linkedEvents(db).map((event) => event.branch)
    expect(branches).toEqual([
      'feat/WOR-6',
      'feat/WOR-6',
      null,
      'main',
      'main',
      'main',
      'main',
      'main',
      null,
      null,
      null,
      null,
    ])
    expect(db.prepare('SELECT COUNT(*) AS count FROM branch').get()).toEqual({ count: 3 })
  })

  it('links a save to its file, relative to its repo', () => {
    const db = database()

    run(db, createProjectDimensionsJob({ probeDirectory: fakeProbe() }))

    expect(
      db
        .prepare(
          `SELECT event_file.event_id, project.identity, file.relative_path, event_file.action FROM event_file
           JOIN file ON file.id = event_file.file_id JOIN project ON project.id = file.project_id`
        )
        .all()
    ).toEqual([{ event_id: 11, identity: SITE, relative_path: 'README.md', action: 'save' }])
  })

  it('records every fallback, and every save it could not place', () => {
    const db = database()

    run(db, createProjectDimensionsJob({ probeDirectory: fakeProbe() }))

    expect(issues(db)).toEqual([
      { reference: '/s/chronicle (cli)', reason: expect.stringMatching(/^2 events: joined .*cli by a bare name/) },
      { reference: '/s/workscribe-landing-page (landing-page)', reason: expect.stringContaining('bare name') },
      { reference: '/s/workscribe-profiles (profiles)', reason: expect.stringContaining('by name') },
      { reference: '/users/s/chronicle (cli)', reason: expect.stringMatching(/^1 event: joined/) },
      { reference: '/home', reason: '1 saved file here, in no repo git could find' },
    ])
  })

  it('passes its check, with a count for each way events were matched', () => {
    const db = database()

    const [result] = run(db, createProjectDimensionsJob({ probeDirectory: fakeProbe() })).jobs

    expect(result.verification).toEqual({
      checked: 12,
      resolved: 12,
      unresolved: 0,
      hasPassed: true,
      notes: [
        '4 events matched by git, at a folder that still exists',
        '4 events matched by a bare name a live repo was also stored under',
        '3 events matched by nothing: captured outside a repo',
        '1 event matched by their name alone (no live repo matched)',
        '1 saved file is in no repo git could find',
      ],
    })
  })

  it('names each project after its newest event, and keeps every name it was stored under', () => {
    const db = database()

    run(db, createProjectDimensionsJob({ probeDirectory: fakeProbe() }))

    expect(db.prepare('SELECT name FROM project WHERE identity = ?').get(CLI)).toEqual({ name: 'workscribe/cli' })
    expect(
      db
        .prepare(
          `SELECT project_alias.name FROM project_alias JOIN project ON project.id = project_alias.project_id
           WHERE identity = ? ORDER BY project_alias.name`
        )
        .all(CLI)
    ).toEqual([{ name: 'cli' }, { name: 'workscribe/cli' }])
  })

  it('asks git once per folder, even across runs and a version bump', () => {
    const db = database()
    const probeDirectory = fakeProbe()
    run(db, createProjectDimensionsJob({ probeDirectory }))
    const firstLinks = linkedEvents(db)

    run(db, { ...createProjectDimensionsJob({ probeDirectory }), version: 2 })

    expect(probeDirectory).toHaveBeenCalledTimes(9)
    expect(linkedEvents(db)).toEqual(firstLinks)
  })

  it('pauses when gathering runs over budget, and carries on where it stopped', () => {
    const db = database()
    const probeDirectory = fakeProbe()
    let probesAllowed = 3
    const job = createProjectDimensionsJob({
      probeDirectory: (directory) => {
        probesAllowed -= 1
        return probeDirectory(directory)
      },
    })

    expect(run(db, job, { budgetMs: 1, now: () => new Date(probesAllowed > 0 ? 0 : 10) }).jobs).toEqual([
      expect.objectContaining({ outcome: 'paused' }),
    ])
    expect(identities(db).every((identity) => identity === null)).toBe(true)

    expect(run(db, job).jobs).toEqual([expect.objectContaining({ outcome: 'done' })])
    expect(probeDirectory).toHaveBeenCalledTimes(9)
  })

  it('ends with the same links after a run interrupted partway through', () => {
    const clean = database()
    run(clean, createProjectDimensionsJob({ probeDirectory: fakeProbe() }))
    const db = database()
    const job = createProjectDimensionsJob({ probeDirectory: fakeProbe() })
    let batches = 0
    const flaky: DataJob = {
      ...job,
      runBatch: (database, afterId, limit) => {
        batches += 1
        if (batches === 2) throw new Error('disk on fire')
        return job.runBatch(database, afterId, limit)
      },
    }

    expect(run(db, flaky).jobs).toEqual([expect.objectContaining({ outcome: 'failed' })])
    expect(run(db, flaky).jobs).toEqual([expect.objectContaining({ outcome: 'done' })])
    expect(linkedEvents(db)).toEqual(linkedEvents(clean))
  })

  it('resolves, by name only, a pair first captured while the job ran — and keeps what capture linked itself', () => {
    const db = database([{ cwd: CLI_ROOT, repo: 'cli' }])
    const job = createProjectDimensionsJob({ probeDirectory: fakeProbe() })
    const capturedMidRun: DataJob = {
      ...job,
      gather: (database, context) => {
        const outcome = job.gather?.(database, context) ?? 'complete'
        insertEvent(db, { cwd: '/s/new-folder', repo: 'workscribe/cli' })
        insertEvent(db, { cwd: '/s/linked-by-capture', repo: 'tool' }, 1)
        return outcome
      },
    }

    run(db, capturedMidRun)

    expect(identities(db)).toEqual([CLI, CLI, CLI])
    expect(issues(db)).toEqual([
      {
        reference: '/s/new-folder (workscribe/cli)',
        reason: expect.stringMatching(/^captured while the upgrade ran; 1 event: joined .*owner\/repo name/),
      },
    ])
  })

  it('never overwrites what capture linked during the run, even in a pair the job already resolved', () => {
    const db = database([{ cwd: '/s/workscribe', repo: null }])
    const job = createProjectDimensionsJob({ probeDirectory: fakeProbe() })
    const capturedMidRun: DataJob = {
      ...job,
      gather: (database, context) => {
        const outcome = job.gather?.(database, context) ?? 'complete'
        // A save from the same workspace, in a folder the job never probed: capture linked it to the site itself
        const siteId = upsertProject(database, {
          identity: SITE,
          kind: 'remote',
          name: 'landing-page',
          root: SITE_ROOT,
        })
        insertEvent(db, { cwd: '/s/workscribe', repo: null, file: `${SITE_ROOT}/new/page.tsx` }, siteId)
        const fileId = upsertFile(database, siteId, 'new/page.tsx')
        linkEventFile(database, { eventId: 2, fileId, action: 'save' })
        return outcome
      },
    }

    run(db, capturedMidRun)

    expect(identities(db)).toEqual([null, SITE])
    expect(db.prepare('SELECT event_id, file_id FROM event_file').all()).toEqual([{ event_id: 2, file_id: 1 }])
    expect(issues(db)).toEqual([])
  })

  it('rebuilds every link on a version bump, from the stored text and the probes', () => {
    const db = database()
    const probeDirectory = fakeProbe()
    run(db, createProjectDimensionsJob({ probeDirectory }))
    const firstLinks = linkedEvents(db)
    const firstFiles = db.prepare('SELECT event_id FROM event_file').all()
    db.exec('UPDATE events SET project_id = NULL, branch_id = NULL; DELETE FROM event_file;')

    run(db, { ...createProjectDimensionsJob({ probeDirectory }), version: 2 })

    expect(linkedEvents(db)).toEqual(firstLinks)
    expect(db.prepare('SELECT event_id FROM event_file').all()).toEqual(firstFiles)
  })

  it('notes, without failing, events removed while it ran — the job itself never deletes one', () => {
    const db = database()
    const job = createProjectDimensionsJob({ probeDirectory: fakeProbe() })
    const undoneMidRun: DataJob = {
      ...job,
      runBatch: (database, afterId, limit) => {
        if (afterId === 0) database.exec('DELETE FROM events WHERE id = 1')
        return job.runBatch(database, afterId, limit)
      },
    }

    const [result] = run(db, undoneMidRun).jobs

    expect(result.verification).toEqual(
      expect.objectContaining({
        hasPassed: true,
        notes: expect.arrayContaining(['1 event removed while the upgrade ran (undo or clear)']),
      })
    )
  })

  it("links a `git -C` event to the repo it worked in, and never names the folder's project after it", () => {
    const db = database([
      { cwd: CLI_ROOT, repo: 'cli' },
      { cwd: SITE_ROOT, repo: 'landing-page' },
      // `git -C ../workscribe-landing-page commit`, typed in the cli folder: stored with the cli folder, the site's name
      { cwd: CLI_ROOT, repo: 'landing-page' },
    ])

    run(db, createProjectDimensionsJob({ probeDirectory: fakeProbe() }))

    expect(identities(db)).toEqual([CLI, SITE, SITE])
    expect(db.prepare('SELECT name FROM project WHERE identity = ?').get(CLI)).toEqual({ name: 'cli' })
  })

  it("keeps a name that fits no live repo (a projects override) on the folder's project, but not as its name", () => {
    const db = database([
      { cwd: CLI_ROOT, repo: 'cli' },
      { cwd: CLI_ROOT, repo: 'my-override' },
    ])

    run(db, createProjectDimensionsJob({ probeDirectory: fakeProbe() }))

    expect(identities(db)).toEqual([CLI, CLI])
    expect(db.prepare('SELECT name FROM project WHERE identity = ?').get(CLI)).toEqual({ name: 'cli' })
    expect(db.prepare('SELECT name FROM project_alias').all()).toEqual([{ name: 'cli' }])
  })
})
