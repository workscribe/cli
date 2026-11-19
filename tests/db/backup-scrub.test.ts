import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { scrubBackups, type BackupDatabase, type BackupScrubResult } from '../../src/db/jobs/backup-scrub'
import { scrubSecretsJob } from '../../src/db/jobs/scrub-secrets'
import { getMetaValue } from '../../src/db/jobs/store'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const SECRET = 'FAKESECRETVALUE'
const COMMAND_WITH_SECRET = `run --password=${SECRET}`
const REDACTED_COMMAND = 'run --password=[REDACTED]'
const PRIVATE_FILE_MODE = 0o600
// More than the 500 rows a batch holds, so the copy takes several
const MANY_EVENTS = 1200

function liveDatabase(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db, MIGRATIONS)
  return db
}

function markScrubJobDone(db: DatabaseSync): void {
  db.prepare(
    `INSERT INTO data_jobs (name, version, cursor, status, started_at)
     VALUES (?, ?, 0, 'done', '2026-11-19T12:00:00.000Z')`
  ).run(scrubSecretsJob.name, scrubSecretsJob.version)
}

function temporaryDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-backup-scrub-'))
  onTestFinished(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

/** A real backup file: the full schema, one event holding a secret in its command and metadata, and a recap. */
function writeBackup(file: string, options: { withSecret?: boolean } = {}): void {
  const hasSecret = options.withSecret ?? true
  const db = new DatabaseSync(file)
  applyMigrations(db, MIGRATIONS)
  db.prepare(
    `INSERT INTO events (captured_at, command, cwd, exit_code, repo_name, branch, category, metadata, source)
     VALUES ('2026-10-28T12:00:00.000Z', ?, '/code/cli', 0, 'cli', 'main', 'other', ?, 'zsh')`
  ).run(
    hasSecret ? COMMAND_WITH_SECRET : 'npm test',
    JSON.stringify({ prompt: hasSecret ? COMMAND_WITH_SECRET : 'ok' })
  )
  db.prepare(
    `INSERT INTO agent_sessions (source, session_id, cwd, started_at, last_seen_at, recap, compact_summary)
     VALUES ('claude-code', 's1', '/code/cli', '2026-10-28T12:00:00.000Z', '2026-10-28T12:00:00.000Z', ?, NULL)`
  ).run(hasSecret ? `Set GITHUB_TOKEN to ghp_${'a1B2c3D4e5'.repeat(4)} and retried` : 'Added a test')
  db.close()
  fs.chmodSync(file, PRIVATE_FILE_MODE)
}

function read(file: string): { command: string; metadata: string; recap: string } {
  const db = new DatabaseSync(file)
  try {
    const event = db.prepare('SELECT command, metadata FROM events').get() as { command: string; metadata: string }
    const session = db.prepare('SELECT recap FROM agent_sessions').get() as { recap: string | null }
    return { ...event, recap: session.recap ?? '' }
  } finally {
    db.close()
  }
}

function holdsSecret(file: string): boolean {
  return fs.readFileSync(file).includes(SECRET)
}

function outcomes(partial: Partial<BackupScrubResult>): BackupScrubResult {
  return { scrubbed: 0, untouched: 0, deferred: 0, unwritable: [], ...partial }
}

function scrub(db: DatabaseSync, directory: string, options: { isOverBudget?: () => boolean } = {}) {
  return scrubBackups(db, { directory, openDatabase: (file) => new DatabaseSync(file), ...options })
}

describe('scrubBackups', () => {
  it('removes the secret from a backup copy — its command, metadata and recap — and from the file itself', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'workscribe-3.5.0-2026-11-19T10-00-00-000Z.db')
    writeBackup(file)
    expect(holdsSecret(file)).toBe(true)
    const live = liveDatabase()
    markScrubJobDone(live)

    const result = scrub(live, directory)

    expect(result).toEqual(outcomes({ scrubbed: 1, untouched: 0, deferred: 0 }))
    const stored = read(file)
    expect(stored.command).toBe(REDACTED_COMMAND)
    expect(stored.metadata).toBe(JSON.stringify({ prompt: REDACTED_COMMAND }))
    expect(stored.recap).toBe('')
    expect(holdsSecret(file)).toBe(false)
  })

  it('scrubs a copy with more rows than one batch, and leaves no old text in its file', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'workscribe-3.5.0-2026-11-19T10-00-00-000Z.db')
    writeBackup(file)
    const db = new DatabaseSync(file)
    const insertEvent = db.prepare(
      `INSERT INTO events (captured_at, command, cwd, exit_code, repo_name, branch, category, metadata, source)
       VALUES ('2026-10-28T12:00:00.000Z', ?, '/code/cli', 0, 'cli', 'main', 'other', ?, 'zsh')`
    )
    for (let index = 0; index < MANY_EVENTS; index++) {
      insertEvent.run(COMMAND_WITH_SECRET, JSON.stringify({ prompt: COMMAND_WITH_SECRET }))
    }
    db.close()
    const live = liveDatabase()
    markScrubJobDone(live)

    scrub(live, directory)

    const check = new DatabaseSync(file)
    const remaining = check.prepare('SELECT COUNT(*) AS count FROM events WHERE command != ?').get(REDACTED_COMMAND)
    check.close()
    expect(remaining).toEqual({ count: 0 })
    expect(holdsSecret(file)).toBe(false)
  })

  it('leaves a copy with nothing to remove byte for byte', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'workscribe-3.4.0-2026-11-01T10-00-00-000Z.db')
    writeBackup(file, { withSecret: false })
    const before = fs.readFileSync(file)
    const live = liveDatabase()
    markScrubJobDone(live)

    const result = scrub(live, directory)

    expect(result).toEqual(outcomes({ scrubbed: 0, untouched: 1, deferred: 0 }))
    expect(fs.readFileSync(file).equals(before)).toBe(true)
  })

  it('does nothing until scrub-secrets is done on the live database', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'workscribe-3.5.0-2026-11-19T10-00-00-000Z.db')
    writeBackup(file)

    const result = scrub(liveDatabase(), directory)

    expect(result).toEqual(outcomes({ scrubbed: 0, untouched: 0, deferred: 0 }))
    expect(holdsSecret(file)).toBe(true)
  })

  it('keeps the file mode, which a copy made by hand may have set differently', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'manual-repair-2026-10-30T16-28-23Z.db')
    writeBackup(file)
    fs.chmodSync(file, 0o640)
    const live = liveDatabase()
    markScrubJobDone(live)

    scrub(live, directory)

    expect(fs.statSync(file).mode & 0o777).toBe(0o640)
    expect(holdsSecret(file)).toBe(false)
  })

  it('scrubs any .db file in the folder, and nothing outside it or without that name', () => {
    const directory = temporaryDirectory()
    const inFolder = path.join(directory, 'backups', 'manual-repair-2026-10-30T16-28-23Z.db')
    const notDatabaseName = path.join(directory, 'backups', 'notes.txt')
    const outside = path.join(directory, 'workscribe.db.pre-wor119')
    fs.mkdirSync(path.dirname(inFolder))
    writeBackup(inFolder)
    writeBackup(outside)
    fs.writeFileSync(notDatabaseName, COMMAND_WITH_SECRET)
    const live = liveDatabase()
    markScrubJobDone(live)

    scrub(live, path.dirname(inFolder))

    expect(holdsSecret(inFolder)).toBe(false)
    expect(holdsSecret(outside)).toBe(true)
    expect(fs.readFileSync(notDatabaseName, 'utf8')).toBe(COMMAND_WITH_SECRET)
  })

  it('handles a copy from before the metadata column and the agent sessions table existed', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'workscribe-3.0.0-2026-11-05T11-02-09-158Z.db')
    const old = new DatabaseSync(file)
    old.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, command TEXT NOT NULL, captured_at TEXT)')
    old.prepare('INSERT INTO events (command) VALUES (?)').run(COMMAND_WITH_SECRET)
    old.close()
    const live = liveDatabase()
    markScrubJobDone(live)

    const result = scrub(live, directory)

    expect(result.scrubbed).toBe(1)
    const db = new DatabaseSync(file)
    expect(db.prepare('SELECT command FROM events').get()).toEqual({ command: REDACTED_COMMAND })
    db.close()
  })

  it('skips a file that is not a database, once, and never reads it as one again', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'workscribe-3.5.0-2026-11-19T10-00-00-000Z.db')
    fs.writeFileSync(file, 'this is not a database')
    const live = liveDatabase()
    markScrubJobDone(live)
    const openDatabase = vi.fn((target: string) => new DatabaseSync(target))

    const first = scrubBackups(live, { directory, openDatabase })
    const second = scrubBackups(live, { directory, openDatabase })

    expect(first).toEqual(outcomes({ scrubbed: 0, untouched: 1, deferred: 0 }))
    expect(second).toEqual(outcomes({ scrubbed: 0, untouched: 0, deferred: 0 }))
    expect(openDatabase).toHaveBeenCalledTimes(1)
    expect(fs.readFileSync(file, 'utf8')).toBe('this is not a database')
  })

  it('leaves a locked copy for the next run, and scrubs it then', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'workscribe-3.5.0-2026-11-19T10-00-00-000Z.db')
    writeBackup(file)
    const live = liveDatabase()
    markScrubJobDone(live)
    const holder = new DatabaseSync(file)
    holder.exec('BEGIN IMMEDIATE')

    const whileLocked = scrub(live, directory)
    holder.exec('ROLLBACK')
    holder.close()

    expect(whileLocked).toEqual(outcomes({ scrubbed: 0, untouched: 0, deferred: 1 }))
    expect(holdsSecret(file)).toBe(true)
    expect(scrub(live, directory)).toEqual(outcomes({ scrubbed: 1, untouched: 0, deferred: 0 }))
    expect(holdsSecret(file)).toBe(false)
  })

  it('leaves a copy as it was when the check after scrubbing fails, owes a vacuum, and scrubs it on the next run', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'workscribe-3.5.0-2026-11-19T10-00-00-000Z.db')
    writeBackup(file)
    const before = fs.readFileSync(file)
    const live = liveDatabase()
    markScrubJobDone(live)
    const key = `scrub-secrets:backup:${scrubSecretsJob.version}:${path.basename(file)}`
    const failingCheck = (target: string): BackupDatabase => {
      const real = new DatabaseSync(target)
      return {
        exec: (sql) => real.exec(sql),
        close: () => real.close(),
        prepare: (sql) =>
          sql === 'PRAGMA quick_check'
            ? { get: () => undefined, all: () => [{ quick_check: 'row 1 missing' }], run: () => undefined }
            : real.prepare(sql),
      }
    }

    const result = scrubBackups(live, { directory, openDatabase: failingCheck })

    expect(result).toEqual(outcomes({ deferred: 1 }))
    expect(fs.readFileSync(file).equals(before)).toBe(true)
    expect(getMetaValue(live, key)).toBe('needs-vacuum')
    expect(scrub(live, directory)).toEqual(outcomes({ scrubbed: 1 }))
    expect(holdsSecret(file)).toBe(false)
  })

  it('owes the vacuum before the rows commit, so a crash at the commit cannot lose it', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'workscribe-3.5.0-2026-11-19T10-00-00-000Z.db')
    writeBackup(file)
    const live = liveDatabase()
    markScrubJobDone(live)
    const key = `scrub-secrets:backup:${scrubSecretsJob.version}:${path.basename(file)}`
    const failingCommit = (target: string): BackupDatabase => {
      const real = new DatabaseSync(target)
      return {
        prepare: (sql) => real.prepare(sql),
        close: () => real.close(),
        exec: (sql) => {
          if (sql === 'COMMIT') throw new Error('disk I/O error')
          real.exec(sql)
        },
      }
    }

    scrubBackups(live, { directory, openDatabase: failingCommit })

    expect(getMetaValue(live, key)).toBe('needs-vacuum')
    expect(read(file).command).toBe(COMMAND_WITH_SECRET)
  })

  it("leaves another application's database alone, though it has an events table with a command column", () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'other-app.db')
    const other = new DatabaseSync(file)
    other.exec('CREATE TABLE events (id INTEGER PRIMARY KEY, command TEXT)')
    other.prepare('INSERT INTO events (command) VALUES (?)').run(COMMAND_WITH_SECRET)
    other.close()
    const before = fs.readFileSync(file)
    const live = liveDatabase()
    markScrubJobDone(live)

    const result = scrub(live, directory)

    expect(result).toEqual(outcomes({ untouched: 1 }))
    expect(fs.readFileSync(file).equals(before)).toBe(true)
  })

  it('scrubs each copy once per job version, and forgets a copy that was pruned', () => {
    const directory = temporaryDirectory()
    const kept = path.join(directory, 'workscribe-3.5.0-2026-11-19T10-00-00-000Z.db')
    const pruned = path.join(directory, 'workscribe-3.3.0-2026-10-01T10-00-00-000Z.db')
    writeBackup(kept)
    writeBackup(pruned)
    const live = liveDatabase()
    markScrubJobDone(live)
    const keyOf = (file: string) => `scrub-secrets:backup:${scrubSecretsJob.version}:${path.basename(file)}`

    scrub(live, directory)
    expect(getMetaValue(live, keyOf(kept))).toBe('done')
    expect(getMetaValue(live, keyOf(pruned))).toBe('done')
    expect(scrub(live, directory)).toEqual(outcomes({ scrubbed: 0, untouched: 0, deferred: 0 }))

    fs.rmSync(pruned)
    scrub(live, directory)
    expect(getMetaValue(live, keyOf(pruned))).toBeNull()
    expect(getMetaValue(live, keyOf(kept))).toBe('done')
  })

  it('stops before the next copy once over budget, and leaves it for next time', () => {
    const directory = temporaryDirectory()
    const first = path.join(directory, 'workscribe-3.4.0-2026-11-01T10-00-00-000Z.db')
    const second = path.join(directory, 'workscribe-3.5.0-2026-11-19T10-00-00-000Z.db')
    writeBackup(first)
    writeBackup(second)
    const live = liveDatabase()
    markScrubJobDone(live)
    let copiesDone = 0
    const isOverBudget = () => copiesDone++ >= 1

    const result = scrub(live, directory, { isOverBudget })

    expect(result).toEqual(outcomes({ scrubbed: 1, untouched: 0, deferred: 1 }))
    expect(holdsSecret(first)).toBe(false)
    expect(holdsSecret(second)).toBe(true)
  })

  it('does nothing when there is no backups folder yet', () => {
    const live = liveDatabase()
    markScrubJobDone(live)

    expect(scrub(live, path.join(temporaryDirectory(), 'missing'))).toEqual(
      outcomes({ scrubbed: 0, untouched: 0, deferred: 0 })
    )
  })

  it('retries a vacuum that failed, though the rows are already clean, and only then records the copy as done', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'workscribe-3.5.0-2026-11-19T10-00-00-000Z.db')
    writeBackup(file)
    const live = liveDatabase()
    markScrubJobDone(live)
    const key = `scrub-secrets:backup:${scrubSecretsJob.version}:${path.basename(file)}`
    const failingVacuum = (target: string): BackupDatabase => {
      const real = new DatabaseSync(target)
      return {
        prepare: (sql) => real.prepare(sql),
        close: () => real.close(),
        exec: (sql) => {
          if (sql === 'VACUUM') throw new Error('database or disk is full')
          real.exec(sql)
        },
      }
    }

    const failed = scrubBackups(live, { directory, openDatabase: failingVacuum })

    expect(failed).toEqual(outcomes({ deferred: 1 }))
    expect(getMetaValue(live, key)).toBe('needs-vacuum')
    expect(read(file).command).toBe(REDACTED_COMMAND)

    const retried = scrub(live, directory)

    expect(retried).toEqual(outcomes({ scrubbed: 1 }))
    expect(getMetaValue(live, key)).toBe('done')
    expect(holdsSecret(file)).toBe(false)
  })

  it('leaves a copy with the modification time it had, so pruning by age still keeps the newest', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'workscribe-3.10.0-2026-11-19T10-00-00-000Z.db')
    writeBackup(file)
    const modifiedAt = new Date('2026-11-19T10:00:00.000Z')
    fs.utimesSync(file, modifiedAt, modifiedAt)
    const live = liveDatabase()
    markScrubJobDone(live)

    scrub(live, directory)

    expect(holdsSecret(file)).toBe(false)
    expect(fs.statSync(file).mtime.getTime()).toBe(modifiedAt.getTime())
  })

  it('still reports a scrubbed copy as scrubbed when it was pruned before its file state could be restored', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'workscribe-3.5.0-2026-11-19T10-00-00-000Z.db')
    writeBackup(file)
    const live = liveDatabase()
    markScrubJobDone(live)
    const prunedOnClose = (target: string): BackupDatabase => {
      const real = new DatabaseSync(target)
      return {
        prepare: (sql) => real.prepare(sql),
        exec: (sql) => real.exec(sql),
        close: () => {
          real.close()
          fs.rmSync(target)
        },
      }
    }

    const result = scrubBackups(live, { directory, openDatabase: prunedOnClose })

    expect(result).toEqual(outcomes({ scrubbed: 1 }))
  })

  it.skipIf(process.getuid?.() === 0)('reports a copy it cannot write once, and does not try it again', () => {
    const directory = temporaryDirectory()
    const file = path.join(directory, 'manual-repair-2026-10-30T16-28-23Z.db')
    writeBackup(file)
    fs.chmodSync(file, 0o444)
    const live = liveDatabase()
    markScrubJobDone(live)
    const openDatabase = vi.fn((target: string) => new DatabaseSync(target))

    const first = scrubBackups(live, { directory, openDatabase })
    const second = scrubBackups(live, { directory, openDatabase })

    expect(first).toEqual(outcomes({ unwritable: [path.basename(file)] }))
    expect(second).toEqual(outcomes({}))
    expect(openDatabase).toHaveBeenCalledTimes(1)
    expect(holdsSecret(file)).toBe(true)
  })
})
