import type { MigrationDatabase } from './migration-types'
import { BUSY_TIMEOUT_MS } from './transaction'
import { debugLog } from '../utils/logger'
import { deleteMetaValue, getMetaValue, setMetaValue } from './jobs/store'
import { CLEANUP_KEY, VACUUMED_KEY } from './retention-state'

// After events are removed (WOR-179) their text may still be in the database file. `secure_delete` zeroes what a removal
// deletes, but the file keeps the pages it had until the write-ahead log is copied into it (a checkpoint), and text that
// earlier deletes and updates left in free pages (`undo`, `clear`, a scrub's old copy) is only gone once the file is rewritten (`VACUUM`).
// Each step is recorded in `meta`, so a busy reader or a crash means carrying on from it. `node:sqlite`-free.

const NEEDS_VACUUM = 'needs-vacuum'
const NEEDS_CHECKPOINT = 'needs-checkpoint'
const CLEANUP_LOCK_WAIT_MS = 200

export type FileCleanupStatus = 'clean' | 'waiting-for-vacuum' | 'checkpoint-busy'

/**
 * Asks for the checkpoint a removal needs, and for one VACUUM, the first time anything is removed: the file may hold
 * text from before removal existed. A later removal leaves nothing a checkpoint doesn't clear.
 */
export function requestFileCleanup(db: MigrationDatabase): void {
  const alreadyVacuumed = getMetaValue(db, VACUUMED_KEY) !== null
  const pending = getMetaValue(db, CLEANUP_KEY)
  if (pending === NEEDS_VACUUM) return
  setMetaValue(db, CLEANUP_KEY, alreadyVacuumed ? NEEDS_CHECKPOINT : NEEDS_VACUUM)
}

export function isFileCleanupPending(db: MigrationDatabase): boolean {
  return getMetaValue(db, CLEANUP_KEY) !== null
}

/** Whether the next step is the VACUUM, which holds the write lock for as long as the file is big. */
export function isVacuumPending(db: MigrationDatabase): boolean {
  return getMetaValue(db, CLEANUP_KEY) === NEEDS_VACUUM
}

function checkpoint(db: MigrationDatabase): boolean {
  const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number } | undefined
  return !result?.busy
}

/**
 * Carries on from the recorded step. The VACUUM runs only when `canVacuum` says so, since a capture can't write while
 * it does; without it the file is checkpointed and the VACUUM stays pending. Never throws: a locked or busy database
 * leaves the step for the next run.
 */
export function runFileCleanup(db: MigrationDatabase, options: { canVacuum: boolean }): FileCleanupStatus {
  const step = getMetaValue(db, CLEANUP_KEY)
  if (step === null) return 'clean'
  try {
    db.exec(`PRAGMA busy_timeout = ${CLEANUP_LOCK_WAIT_MS}`)
    if (step === NEEDS_VACUUM) {
      if (!options.canVacuum) return checkpoint(db) ? 'waiting-for-vacuum' : 'checkpoint-busy'
      db.exec('VACUUM')
      setMetaValue(db, VACUUMED_KEY, 'true')
      setMetaValue(db, CLEANUP_KEY, NEEDS_CHECKPOINT)
    }
    if (!checkpoint(db)) return 'checkpoint-busy'
    deleteMetaValue(db, CLEANUP_KEY)
    return 'clean'
  } catch (error) {
    debugLog('retention: file cleanup', error)
    return 'checkpoint-busy'
  } finally {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  }
}
