import fs from 'fs'
import path from 'path'
import type { MigrationDatabase } from '../migration-types'
import { isDatabaseLocked, withImmediateTransaction } from '../transaction'
import { debugLog } from '../../utils/logger'
import { errorMessage } from '../../utils/error-message'
import { deleteMetaValue, getMetaValue, setMetaValue } from './store'

export const BACKUP_KEY_PREFIX = 'backup:'
export const BACKUPS_KEPT = 3
// A claim this old belongs to a process that died mid-backup
export const STALE_CLAIM_MS = 10 * 60 * 1000

const FINISHED_BACKUP = /^workscribe-.+\.db$/
const TEMP_SUFFIX = '.tmp'
const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600

/** What `meta['backup:<version>']` holds: a claim while a backup is being taken, then where it went. */
export type BackupRecord = { state: 'claimed'; at: string } | { state: 'done'; at: string; path: string }

export type BackupOutcome =
  | { status: 'exists'; path: string }
  | { status: 'created'; path: string }
  | { status: 'busy' }
  | { status: 'failed'; error: string }

export interface BackupOptions {
  cliVersion: string
  directory: string
  now?: () => Date
  /** Called just before a new backup is taken — the slow part, worth telling the user about. */
  onCreate?: () => void
}

export function parseBackupRecord(value: string | null): BackupRecord | null {
  if (value === null) return null
  try {
    return JSON.parse(value) as BackupRecord
  } catch {
    // An unreadable record is treated as no record: the worst case is one extra backup
    return null
  }
}

type Claim = { status: 'exists'; path: string } | { status: 'busy' } | { status: 'claimed' }

/** Claims the version's backup under the write lock, so two processes never both take it. */
function claimBackup(db: MigrationDatabase, key: string, now: Date): Claim {
  return withImmediateTransaction(db, () => {
    const record = parseBackupRecord(getMetaValue(db, key))
    if (record?.state === 'done') return { status: 'exists', path: record.path }
    const isClaimedElsewhere = record?.state === 'claimed' && now.getTime() - Date.parse(record.at) < STALE_CLAIM_MS
    if (isClaimedElsewhere) return { status: 'busy' }
    setMetaValue(db, key, JSON.stringify({ state: 'claimed', at: now.toISOString() }))
    return { status: 'claimed' }
  })
}

/** The backups folder, private to the user: `VACUUM INTO` creates world-readable files. */
function preparePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  fs.chmodSync(directory, PRIVATE_DIRECTORY_MODE)
  for (const file of fs.readdirSync(directory)) {
    if (file.endsWith(TEMP_SUFFIX)) fs.rmSync(path.join(directory, file), { force: true })
  }
}

/** Keeps the newest finished backups; temp files and anything else in the folder are never counted. */
export function pruneBackups(directory: string, keep: number = BACKUPS_KEPT): void {
  const backups = fs
    .readdirSync(directory)
    .filter((file) => FINISHED_BACKUP.test(file))
    .map((file) => ({ file, modifiedAt: fs.statSync(path.join(directory, file)).mtimeMs }))
    .sort((first, second) => second.modifiedAt - first.modifiedAt)
  for (const backup of backups.slice(keep)) fs.rmSync(path.join(directory, backup.file), { force: true })
}

function backupKey(cliVersion: string): string {
  return `${BACKUP_KEY_PREFIX}${cliVersion}`
}

/**
 * The copy was taken while this version's claim was in progress, so it holds that claim. Restored as is, it would
 * make every command think a backup is under way for up to STALE_CLAIM_MS.
 */
function clearClaimInCopy(db: MigrationDatabase, copyPath: string, key: string): void {
  db.prepare('ATTACH DATABASE ? AS backup_copy').run(copyPath)
  try {
    db.prepare('DELETE FROM backup_copy.meta WHERE key = ?').run(key)
  } finally {
    db.exec('DETACH DATABASE backup_copy')
  }
}

/** Copies the live database (WAL included) to a private file, appearing under its final name only once it's 0600. */
function copyDatabase(db: MigrationDatabase, options: BackupOptions, now: Date): string {
  preparePrivateDirectory(options.directory)
  const name = `workscribe-${options.cliVersion}-${now.toISOString().replace(/[:.]/g, '-')}.db`
  const finalPath = path.join(options.directory, name)
  const tempPath = `${finalPath}${TEMP_SUFFIX}`
  try {
    // VACUUM can't run inside a transaction, so this runs on its own; SQLite gives it a consistent snapshot
    db.prepare('VACUUM INTO ?').run(tempPath)
    fs.chmodSync(tempPath, PRIVATE_FILE_MODE)
    clearClaimInCopy(db, tempPath, backupKey(options.cliVersion))
    fs.renameSync(tempPath, finalPath)
  } catch (error) {
    fs.rmSync(tempPath, { force: true })
    throw error
  }
  pruneBackups(options.directory)
  return finalPath
}

/**
 * Makes sure this CLI version has a backup of the database before any data job changes it. Never call it from
 * `_capture` or `_hook`: the copy takes as long as the database is big.
 */
export function ensureBackup(db: MigrationDatabase, options: BackupOptions): BackupOutcome {
  const now = options.now?.() ?? new Date()
  const key = backupKey(options.cliVersion)
  const claim = tryClaimBackup(db, key, now)
  if (claim.status !== 'claimed') return claim

  try {
    options.onCreate?.()
    const backupPath = copyDatabase(db, options, now)
    setMetaValue(db, key, JSON.stringify({ state: 'done', at: now.toISOString(), path: backupPath }))
    return { status: 'created', path: backupPath }
  } catch (error) {
    releaseClaim(db, key)
    return { status: 'failed', error: errorMessage(error) }
  }
}

/** Another process holding the write lock (a capture, or another command claiming the backup) means try later. */
function tryClaimBackup(db: MigrationDatabase, key: string, now: Date): Claim {
  try {
    return claimBackup(db, key, now)
  } catch (error) {
    if (isDatabaseLocked(error)) return { status: 'busy' }
    throw error
  }
}

/** Lets the next run try again. If the database refuses even this, the claim goes stale after STALE_CLAIM_MS. */
function releaseClaim(db: MigrationDatabase, key: string): void {
  try {
    deleteMetaValue(db, key)
  } catch (error) {
    debugLog('data job backup: release claim', error)
  }
}
