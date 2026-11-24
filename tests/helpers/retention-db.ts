import { onTestFinished } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { JOBS } from '../../src/db/jobs'
import { GATE_JOB_NAMES } from '../../src/db/retention-run'

// A real SQLite database in a temp folder, for the tests of removing old data (WOR-179): a file, with the write-ahead
// log on, because the removal's locks and its effect on the file's bytes are part of what is tested. Closed and
// deleted when the test ends. Tests that use it mock `../../src/config` and `../../src/profiles/loader`, which the
// migrations read.

export interface TemporaryDatabase {
  db: DatabaseSync
  file: string
  directory: string
}

export function openTemporaryDatabase(options: { gatesDone?: boolean } = {}): TemporaryDatabase {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-retention-'))
  const file = path.join(directory, 'workscribe.db')
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  onTestFinished(() => {
    db.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  if (options.gatesDone) markGateJobsDone(db)
  return { db, file, directory }
}

/** The jobs removal waits for, as a finished upgrade leaves them. */
export function markGateJobsDone(db: DatabaseSync): void {
  for (const job of JOBS.filter((candidate) => GATE_JOB_NAMES.includes(candidate.name))) {
    db.prepare("INSERT INTO data_jobs (name, version, cursor, status) VALUES (?, ?, 0, 'done')").run(
      job.name,
      job.version
    )
  }
}

export function insertEventAt(db: DatabaseSync, capturedAt: Date, command = 'npm test'): number {
  const result = db
    .prepare("INSERT INTO events (captured_at, command, cwd, category) VALUES (?, ?, '/repo', 'testing')")
    .run(capturedAt.toISOString(), command)
  return Number(result.lastInsertRowid)
}

export function countRows(db: DatabaseSync, table: string): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}
