import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { ensureBackup, pruneBackups, STALE_CLAIM_MS } from '../../src/db/jobs/backup'
import { getMetaValue, setMetaValue } from '../../src/db/jobs/store'

vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const NOW = new Date('2026-10-29T12:00:00.000Z')

/** A live WAL database in a temp folder, with a backups folder path next to it. */
function liveDatabase(folderName = 'workscribe-backup-'): { db: DatabaseSync; directory: string; backups: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), folderName))
  const db = new DatabaseSync(path.join(directory, 'workscribe.db'))
  db.exec('PRAGMA journal_mode = WAL')
  applyMigrations(db, MIGRATIONS)
  db.prepare(
    "INSERT INTO events (captured_at, command, cwd, category) VALUES ('2026-10-28T12:00:00.000Z', 'ls', '/repo', 'files')"
  ).run()
  onTestFinished(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return { db, directory, backups: path.join(directory, 'backups') }
}

function mode(file: string): number {
  return fs.statSync(file).mode & 0o777
}

describe('ensureBackup', () => {
  it('copies the database to a private file and records it for the version', () => {
    const { db, backups } = liveDatabase()
    const onCreate = vi.fn()

    const outcome = ensureBackup(db, { cliVersion: '2.2.0', directory: backups, now: () => NOW, onCreate })

    expect(outcome.status).toBe('created')
    if (outcome.status !== 'created') return
    const copy = new DatabaseSync(outcome.path, { readOnly: true })
    onTestFinished(() => copy.close())
    expect(copy.prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 1 })
    expect(mode(backups)).toBe(0o700)
    expect(mode(outcome.path)).toBe(0o600)
    expect(onCreate).toHaveBeenCalledTimes(1)
    expect(JSON.parse(getMetaValue(db, 'backup:2.2.0') ?? '{}')).toEqual(
      expect.objectContaining({ state: 'done', path: outcome.path })
    )
  })

  it('leaves the in-progress claim out of the copy, so a restored backup is not stuck "backing up"', () => {
    const { db, backups } = liveDatabase()

    const outcome = ensureBackup(db, { cliVersion: '2.2.0', directory: backups, now: () => NOW })

    if (outcome.status !== 'created') throw new Error(`expected a new backup, got ${outcome.status}`)
    const copy = new DatabaseSync(outcome.path, { readOnly: true })
    onTestFinished(() => copy.close())
    expect(getMetaValue(copy, 'backup:2.2.0')).toBeNull()
    expect(fs.readdirSync(backups)).toEqual([path.basename(outcome.path)])
  })

  it('takes one backup per version', () => {
    const { db, backups } = liveDatabase()
    const first = ensureBackup(db, { cliVersion: '2.2.0', directory: backups, now: () => NOW })

    const second = ensureBackup(db, { cliVersion: '2.2.0', directory: backups, now: () => NOW })

    expect(second).toEqual({ status: 'exists', path: first.status === 'created' ? first.path : '' })
    expect(fs.readdirSync(backups)).toHaveLength(1)
  })

  it('tightens a backups folder that already exists with looser permissions', () => {
    const { db, backups } = liveDatabase()
    fs.mkdirSync(backups, { mode: 0o755 })

    ensureBackup(db, { cliVersion: '2.2.0', directory: backups, now: () => NOW })

    expect(mode(backups)).toBe(0o700)
  })

  it("works when the folder's path has a single quote in it", () => {
    const { db, directory } = liveDatabase("workscribe-o'brien-")

    const outcome = ensureBackup(db, {
      cliVersion: '2.2.0',
      directory: path.join(directory, "it's backups"),
      now: () => NOW,
    })

    expect(outcome.status).toBe('created')
  })

  it('waits for a backup another process is taking', () => {
    const { db, backups } = liveDatabase()
    setMetaValue(
      db,
      'backup:2.2.0',
      JSON.stringify({ state: 'claimed', at: new Date(NOW.getTime() - 1000).toISOString() })
    )

    expect(ensureBackup(db, { cliVersion: '2.2.0', directory: backups, now: () => NOW })).toEqual({ status: 'busy' })
    expect(fs.existsSync(backups)).toBe(false)
  })

  it('waits, rather than failing, while another process holds the write lock', () => {
    const { db, directory, backups } = liveDatabase()
    const other = new DatabaseSync(path.join(directory, 'workscribe.db'))
    onTestFinished(() => other.close())
    db.exec('PRAGMA busy_timeout = 50')
    other.exec('BEGIN IMMEDIATE')

    const outcome = ensureBackup(db, { cliVersion: '2.2.0', directory: backups, now: () => NOW })
    other.exec('ROLLBACK')

    expect(outcome).toEqual({ status: 'busy' })
  })

  it('takes over a claim left by a process that died', () => {
    const { db, backups } = liveDatabase()
    const abandonedAt = new Date(NOW.getTime() - STALE_CLAIM_MS - 1000).toISOString()
    setMetaValue(db, 'backup:2.2.0', JSON.stringify({ state: 'claimed', at: abandonedAt }))

    expect(ensureBackup(db, { cliVersion: '2.2.0', directory: backups, now: () => NOW }).status).toBe('created')
  })

  it('releases the claim and leaves no file when the copy fails', () => {
    const { db, directory } = liveDatabase()
    const blocked = path.join(directory, 'not-a-folder')
    fs.writeFileSync(blocked, '')

    const outcome = ensureBackup(db, { cliVersion: '2.2.0', directory: blocked, now: () => NOW })

    expect(outcome.status).toBe('failed')
    expect(getMetaValue(db, 'backup:2.2.0')).toBeNull()
  })

  it('clears temp files a crashed run left behind', () => {
    const { db, backups } = liveDatabase()
    fs.mkdirSync(backups, { recursive: true })
    fs.writeFileSync(path.join(backups, 'workscribe-2.1.0-crashed.db.tmp'), 'partial')

    ensureBackup(db, { cliVersion: '2.2.0', directory: backups, now: () => NOW })

    expect(fs.readdirSync(backups).some((file) => file.endsWith('.tmp'))).toBe(false)
  })
})

describe('pruneBackups', () => {
  it('keeps the newest finished backups and ignores other files', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-prune-'))
    onTestFinished(() => fs.rmSync(directory, { recursive: true, force: true }))
    const names = ['workscribe-2.0.0-a.db', 'workscribe-2.1.0-b.db', 'workscribe-2.2.0-c.db', 'workscribe-2.3.0-d.db']
    names.forEach((name, index) => {
      const file = path.join(directory, name)
      fs.writeFileSync(file, '')
      fs.utimesSync(file, index + 1, index + 1)
    })
    fs.writeFileSync(path.join(directory, 'notes.txt'), '')
    fs.writeFileSync(path.join(directory, 'workscribe-2.4.0-e.db.tmp'), '')

    pruneBackups(directory, 3)

    expect(fs.readdirSync(directory).sort()).toEqual([
      'notes.txt',
      'workscribe-2.1.0-b.db',
      'workscribe-2.2.0-c.db',
      'workscribe-2.3.0-d.db',
      'workscribe-2.4.0-e.db.tmp',
    ])
  })
})
