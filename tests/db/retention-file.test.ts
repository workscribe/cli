import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { removeExpiredEvents } from '../../src/db/retention'
import {
  isFileCleanupPending,
  isVacuumPending,
  requestFileCleanup,
  runFileCleanup,
} from '../../src/db/retention-cleanup'
import { CLEANUP_KEY } from '../../src/db/retention-state'

vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

// What a secret that no pattern caught looks like in a stored command: a marker nothing else in the file contains
const MARKER = 'XQZ-RETENTION-MARKER-7f3a9c'
const OLD_DAY = new Date(2026, 7, 1, 12)
const KEPT_DAY = new Date(2026, 10, 20, 12)
const CUTOFF = new Date(2026, 10, 1).toISOString()

function openDatabase(): { db: DatabaseSync; file: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-retention-file-'))
  const file = path.join(directory, 'workscribe.db')
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  onTestFinished(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  return { db, file }
}

/** Every byte the database holds on disk: the file, and the write-ahead log that has not been copied into it. */
function bytesOnDisk(file: string): Buffer {
  const parts = [file, `${file}-wal`].filter((name) => fs.existsSync(name)).map((name) => fs.readFileSync(name))
  return Buffer.concat(parts)
}

const holdsMarker = (file: string): boolean => bytesOnDisk(file).includes(MARKER)

function seed(db: DatabaseSync): void {
  const insert = db.prepare(
    "INSERT INTO events (captured_at, command, cwd, category) VALUES (?, ?, '/repo', 'running')"
  )
  insert.run(OLD_DAY.toISOString(), `deploy --token ${MARKER}`)
  insert.run(KEPT_DAY.toISOString(), 'npm test')
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
}

describe('removed text leaves the database file (WOR-179)', () => {
  it('has the marker on disk before the removal, so the check below can fail', () => {
    const { db, file } = openDatabase()
    seed(db)

    expect(holdsMarker(file)).toBe(true)
  })

  it('does not keep it in the file or the log once the removal and a checkpoint are done', () => {
    const { db, file } = openDatabase()
    seed(db)

    removeExpiredEvents(db, { cutoff: CUTOFF })
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

    expect(db.prepare('SELECT COUNT(*) AS count FROM events').get()).toEqual({ count: 1 })
    expect(holdsMarker(file)).toBe(false)
  })

  it('does not keep it in the log before the checkpoint either', () => {
    const { db, file } = openDatabase()
    seed(db)

    removeExpiredEvents(db, { cutoff: CUTOFF })

    // The log holds the pages as the removal wrote them, zeroed, and the file the earlier ones until the checkpoint.
    // The marker is allowed in the file until then; it is not allowed in the log
    const log = fs.existsSync(`${file}-wal`) ? fs.readFileSync(`${file}-wal`) : Buffer.alloc(0)
    expect(log.includes(MARKER)).toBe(false)
  })
})

describe('text an earlier delete left in the file', () => {
  const REMNANT = 'XQZ-REMNANT-MARKER-51d2e8'
  const FILLER_EVENTS = 150

  /**
   * Old events (to be removed), kept events, then one that was deleted before removal existed, as `undo` and `clear`
   * delete: its text stays in the page's free space, which the removal of the old events never touches.
   */
  function seedDeleted(db: DatabaseSync): void {
    const insert = db.prepare(
      "INSERT INTO events (captured_at, command, cwd, category) VALUES (?, ?, '/repo', 'running')"
    )
    for (let index = 0; index < FILLER_EVENTS; index++)
      insert.run(OLD_DAY.toISOString(), `build ${'x'.repeat(200)} ${index}`)
    for (let index = 0; index < FILLER_EVENTS; index++)
      insert.run(KEPT_DAY.toISOString(), `test ${'y'.repeat(200)} ${index}`)
    insert.run(KEPT_DAY.toISOString(), `deploy --token ${REMNANT}`)
    db.prepare('DELETE FROM events WHERE command LIKE ?').run(`%${REMNANT}`)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
  }

  it('stays after a removal and a checkpoint, which is why one VACUUM is asked for', () => {
    const { db, file } = openDatabase()
    seedDeleted(db)
    expect(bytesOnDisk(file).includes(REMNANT)).toBe(true)

    removeExpiredEvents(db, { cutoff: CUTOFF })
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')

    expect(bytesOnDisk(file).includes(REMNANT)).toBe(true)
  })

  it('is gone after the cleanup has vacuumed, then checkpointed', () => {
    const { db, file } = openDatabase()
    seedDeleted(db)
    removeExpiredEvents(db, { cutoff: CUTOFF })
    requestFileCleanup(db)

    expect(runFileCleanup(db, { canVacuum: true })).toBe('clean')

    expect(bytesOnDisk(file).includes(REMNANT)).toBe(false)
    expect(isFileCleanupPending(db)).toBe(false)
  })
})

describe('file cleanup steps', () => {
  it('asks for a VACUUM the first time and only a checkpoint after that', () => {
    const { db } = openDatabase()

    requestFileCleanup(db)
    expect(isVacuumPending(db)).toBe(true)
    runFileCleanup(db, { canVacuum: true })

    requestFileCleanup(db)
    expect(isFileCleanupPending(db)).toBe(true)
    expect(isVacuumPending(db)).toBe(false)
    expect(runFileCleanup(db, { canVacuum: false })).toBe('clean')
  })

  it('checkpoints but leaves the VACUUM pending when it is not allowed to take the lock', () => {
    const { db } = openDatabase()
    requestFileCleanup(db)

    expect(runFileCleanup(db, { canVacuum: false })).toBe('waiting-for-vacuum')
    expect(isVacuumPending(db)).toBe(true)
  })

  it('does nothing when nothing was asked for', () => {
    const { db } = openDatabase()

    expect(runFileCleanup(db, { canVacuum: true })).toBe('clean')
    expect(isFileCleanupPending(db)).toBe(false)
  })

  it('leaves the step for the next run while a reader holds the log', () => {
    const { db, file } = openDatabase()
    db.exec(
      "INSERT INTO events (captured_at, command, cwd, category) VALUES ('2026-11-20T10:00:00.000Z', 'ls', '/r', 'files')"
    )
    const reader = new DatabaseSync(file)
    onTestFinished(() => reader.close())
    reader.exec('BEGIN')
    reader.prepare('SELECT COUNT(*) FROM events').get()
    db.exec(
      "INSERT INTO events (captured_at, command, cwd, category) VALUES ('2026-11-21T10:00:00.000Z', 'ls', '/r', 'files')"
    )
    requestFileCleanup(db)
    db.exec(`UPDATE meta SET value = 'needs-checkpoint' WHERE key = '${CLEANUP_KEY}'`)

    expect(runFileCleanup(db, { canVacuum: false })).toBe('checkpoint-busy')
    expect(isFileCleanupPending(db)).toBe(true)

    reader.exec('ROLLBACK')
    expect(runFileCleanup(db, { canVacuum: false })).toBe('clean')
  })
})
