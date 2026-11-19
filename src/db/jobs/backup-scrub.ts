import fs from 'fs'
import path from 'path'
import type { MigrationDatabase } from '../migration-types'
import { isDatabaseLocked, withImmediateTransaction } from '../transaction'
import { debugLog } from '../../utils/logger'
import { deleteMetaValue, getJobRow, getMetaValue, getMetaValuesWithPrefix, isJobDone, setMetaValue } from './store'
import { scrubAgentMessages, scrubEventBatch, scrubSecretsJob } from './scrub-secrets'

// A backup copy still holds what the live database no longer does: the text as it was before `scrub-secrets` ran. Once
// that job is done, the same rule is applied to each copy in the backups folder (WOR-180), which is then vacuumed so
// the old bytes leave the file. Like the jobs, this is `node:sqlite`-free: the caller supplies the way to open a file.

const BACKUP_FILE = /\.db$/
const SCRUBBED_KEY_PREFIX = 'scrub-secrets:backup:'
const STATE_DONE = 'done'
const STATE_SKIPPED = 'skipped'
const STATE_UNWRITABLE = 'unwritable'
// The rows are rewritten but the old text may still sit in the file's free pages: the vacuum is still owed
const STATE_NEEDS_VACUUM = 'needs-vacuum'
const BATCH_SIZE = 500
// A copy is nobody's live database, so a lock on it means a backup or restore is under way: try again next time
const BACKUP_LOCK_WAIT_MS = 200
// SQLite's SQLITE_CORRUPT and SQLITE_NOTADB: the file can't be read as a database, and trying again won't change that
const UNREADABLE_ERROR_CODES = [11, 26]
// SQLITE_READONLY: the file can't be written (by this user, or on this disk)
const READONLY_ERROR_CODE = 8
// An extended result code carries its primary code in the low byte
const PRIMARY_ERROR_CODE_MASK = 0xff
const FILE_MODE_MASK = 0o777

export interface BackupDatabase extends MigrationDatabase {
  close(): void
}

export interface BackupScrubOptions {
  directory: string
  openDatabase: (file: string) => BackupDatabase
  /** Stop before the next copy once true. Omitted: scrub every copy. */
  isOverBudget?: () => boolean
}

export interface BackupScrubResult {
  /** Copies that held a secret, now removed. */
  scrubbed: number
  /** Copies with nothing to remove, or that aren't Workscribe databases. */
  untouched: number
  /** Copies left for the next run: locked, over budget, or whose vacuum didn't finish. */
  deferred: number
  /** Copies that can't be written, which still hold their secrets. Reported once, then left alone. */
  unwritable: string[]
}

type FileOutcome = 'scrubbed' | 'untouched' | 'not-a-workscribe-database' | 'unwritable' | 'deferred'

/** What a copy looked like before it was touched, so the scrub leaves no trace in how it sorts or who can read it. */
interface FileState {
  mode: number
  accessedAt: Date
  modifiedAt: Date
}

interface ScrubFileOptions {
  openDatabase: BackupScrubOptions['openDatabase']
  /** The vacuum didn't finish last time, so it runs even though the rows are already clean. */
  mustVacuum: boolean
  /** Called once rows have been rewritten, before they commit: from then on a vacuum is owed. */
  onRowsScrubbed: () => void
}

const FINAL_STATE: Record<Exclude<FileOutcome, 'deferred'>, string> = {
  scrubbed: STATE_DONE,
  untouched: STATE_DONE,
  'not-a-workscribe-database': STATE_SKIPPED,
  unwritable: STATE_UNWRITABLE,
}

function sqliteErrorCode(error: unknown): number | undefined {
  const errorCode = (error as { errcode?: unknown } | null)?.errcode
  return typeof errorCode === 'number' ? errorCode & PRIMARY_ERROR_CODE_MASK : undefined
}

function isUnreadableDatabaseError(error: unknown): boolean {
  const errorCode = sqliteErrorCode(error)
  return errorCode !== undefined && UNREADABLE_ERROR_CODES.includes(errorCode)
}

function isReadOnlyError(error: unknown): boolean {
  return sqliteErrorCode(error) === READONLY_ERROR_CODE
}

function stateKey(version: number, name: string): string {
  return `${SCRUBBED_KEY_PREFIX}${version}:${name}`
}

function isFinished(state: string | null): boolean {
  return state === STATE_DONE || state === STATE_SKIPPED || state === STATE_UNWRITABLE
}

function columnsOf(db: MigrationDatabase, table: string): Set<string> {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  return new Set(columns.map((column) => column.name))
}

function scrubEvents(db: MigrationDatabase, columns: Set<string>): number {
  const eventColumns = { hasMetadata: columns.has('metadata'), hasFilePath: columns.has('file_path') }
  let changed = 0
  let afterId = 0
  for (;;) {
    const batch = scrubEventBatch(db, afterId, BATCH_SIZE, eventColumns)
    if (batch.lastId === null) return changed
    changed += batch.changed
    afterId = batch.lastId
  }
}

function scrubRecaps(db: MigrationDatabase): number {
  const columns = columnsOf(db, 'agent_sessions')
  return columns.has('recap') && columns.has('compact_summary') ? scrubAgentMessages(db) : 0
}

// Structural only, and so quick: the check runs holding the copy's write lock, inside a command someone typed
function assertIntact(db: MigrationDatabase): void {
  const rows = db.prepare('PRAGMA quick_check').all() as { quick_check: string }[]
  if (rows.length !== 1 || rows[0].quick_check !== 'ok') throw new Error('integrity check failed after scrubbing')
}

// Every Workscribe database has both, so another app's `events` table with a `command` column is left alone
const REQUIRED_EVENT_COLUMNS = ['command', 'captured_at']

/**
 * Scrubs one open copy in a single transaction, checked before it commits. `onRowsChanged` runs inside it, before the
 * commit, so the vacuum is already owed if the process dies right after. Null: it isn't a Workscribe database.
 */
function scrubOpenBackup(db: MigrationDatabase, onRowsChanged: () => void): number | null {
  const eventColumns = columnsOf(db, 'events')
  if (!REQUIRED_EVENT_COLUMNS.every((column) => eventColumns.has(column))) return null
  return withImmediateTransaction(db, () => {
    const changed = scrubEvents(db, eventColumns) + scrubRecaps(db)
    if (changed === 0) return 0
    onRowsChanged()
    assertIntact(db)
    return changed
  })
}

function fileStateOf(file: string): FileState {
  const stats = fs.statSync(file)
  return { mode: stats.mode & FILE_MODE_MASK, accessedAt: stats.atime, modifiedAt: stats.mtime }
}

/**
 * Puts back what the rewrite changed. `pruneBackups` keeps the newest copies by modification time, and the scrub goes
 * in name order, so a copy left with the time it was scrubbed could push out a newer one. Best effort: a copy another
 * process just pruned, or one we can't touch, must not turn a finished scrub into a failure.
 */
function restoreFileState(file: string, before: FileState): void {
  try {
    const after = fileStateOf(file)
    if (after.mode !== before.mode) fs.chmodSync(file, before.mode)
    if (after.modifiedAt.getTime() !== before.modifiedAt.getTime()) {
      fs.utimesSync(file, before.accessedAt, before.modifiedAt)
    }
  } catch (error) {
    debugLog(`scrub-secrets: restoring ${path.basename(file)}`, error)
  }
}

/** Not being able to record it (the live database is busy) mustn't stop the scrub, or the vacuum after it. */
function recordVacuumOwed(record: () => void): void {
  try {
    record()
  } catch (error) {
    debugLog('scrub-secrets: recording an owed vacuum', error)
  }
}

function scrubBackupFile(file: string, { openDatabase, mustVacuum, onRowsScrubbed }: ScrubFileOptions): FileOutcome {
  const before = fileStateOf(file)
  const backup = openDatabase(file)
  try {
    backup.exec(`PRAGMA busy_timeout = ${BACKUP_LOCK_WAIT_MS}`)
    const changed = scrubOpenBackup(backup, () => recordVacuumOwed(onRowsScrubbed))
    if (changed === null) return 'not-a-workscribe-database'
    if (changed === 0 && !mustVacuum) return 'untouched'
    // The rewritten rows leave their old text in free pages until the file is rewritten, and a failed vacuum must be
    // tried again even though the next look finds the rows clean
    backup.exec('VACUUM')
    return 'scrubbed'
  } finally {
    backup.close()
    restoreFileState(file, before)
  }
}

function attemptScrub(file: string, options: ScrubFileOptions): FileOutcome {
  try {
    return scrubBackupFile(file, options)
  } catch (error) {
    if (isUnreadableDatabaseError(error)) return 'not-a-workscribe-database'
    if (isReadOnlyError(error)) return 'unwritable'
    if (!isDatabaseLocked(error)) debugLog(`scrub-secrets: backup ${path.basename(file)}`, error)
    return 'deferred'
  }
}

function backupNames(directory: string): string[] {
  try {
    return fs
      .readdirSync(directory)
      .filter((name) => BACKUP_FILE.test(name))
      .sort()
  } catch {
    // No backups folder yet: nothing to scrub
    return []
  }
}

/** A copy that was pruned or deleted needs no record any more. */
function forgetMissingBackups(db: MigrationDatabase, names: string[]): void {
  const present = new Set(names)
  for (const key of getMetaValuesWithPrefix(db, SCRUBBED_KEY_PREFIX).keys()) {
    const name = key.slice(key.indexOf(':') + 1)
    if (!present.has(name)) deleteMetaValue(db, `${SCRUBBED_KEY_PREFIX}${key}`)
  }
}

function recordOutcome(
  db: MigrationDatabase,
  { key, name }: { key: string; name: string },
  outcome: FileOutcome,
  result: BackupScrubResult
): void {
  if (outcome === 'deferred') {
    result.deferred++
    return
  }
  setMetaValue(db, key, FINAL_STATE[outcome])
  if (outcome === 'scrubbed') result.scrubbed++
  else if (outcome === 'unwritable') result.unwritable.push(name)
  else result.untouched++
}

/**
 * Removes secrets from the `.db` copies in the backups folder, once `scrub-secrets` is done on the live database. Each
 * copy is scrubbed once per job version (recorded in `meta`), and a locked, over-budget or half-finished copy is left
 * for the next run. It never throws for a bad copy: a backup that can't be scrubbed is a smaller problem than an
 * upgrade that stops.
 */
export function scrubBackups(db: MigrationDatabase, options: BackupScrubOptions): BackupScrubResult {
  const result: BackupScrubResult = { scrubbed: 0, untouched: 0, deferred: 0, unwritable: [] }
  if (!isJobDone(getJobRow(db, scrubSecretsJob.name), scrubSecretsJob)) return result
  const names = backupNames(options.directory)
  forgetMissingBackups(db, names)
  for (const name of names) {
    const key = stateKey(scrubSecretsJob.version, name)
    const state = getMetaValue(db, key)
    if (isFinished(state)) continue
    if (options.isOverBudget?.()) {
      result.deferred++
      continue
    }
    const outcome = attemptScrub(path.join(options.directory, name), {
      openDatabase: options.openDatabase,
      mustVacuum: state === STATE_NEEDS_VACUUM,
      onRowsScrubbed: () => setMetaValue(db, key, STATE_NEEDS_VACUUM),
    })
    recordOutcome(db, { key, name }, outcome, result)
  }
  return result
}
