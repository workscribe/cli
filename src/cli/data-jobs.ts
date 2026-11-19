import { getDb, openDatabaseFile } from '../db'
import { JOBS } from '../db/jobs'
import { ensureBackup } from '../db/jobs/backup'
import { scrubBackups } from '../db/jobs/backup-scrub'
import { runPendingJobs, type RunOptions, type RunResult } from '../db/jobs/runner'
import { readDataStatus, recordCliVersion, type DataStatus } from '../db/jobs/state'
import { BACKUPS_DIR } from '../utils/paths'
import { debugLog, log } from '../utils/logger'
import { errorMessage } from '../utils/error-message'

// A command people typed waits at most this long for data jobs before it does its own work; the rest runs next time
export const IMPLICIT_RUN_BUDGET_MS = 2000
// Say something only when a run is slow enough to notice
const PROGRESS_NOTICE_AFTER_MS = 1000

// Scrubbing the backup copies rewrites files, so a command people typed gives it a short budget of its own
const BACKUP_SCRUB_BUDGET_MS = 1000

const UNWRITABLE_NOTICE =
  "Couldn't remove secrets from these Workscribe backups, which can't be written (delete them or fix their permissions):"

const BACKUP_NOTICE = 'Backing up your Workscribe data before upgrading it (once per version)…'
const PROGRESS_NOTICE = 'Upgrading your Workscribe data… (run `workscribe upgrade` to finish it in one go)'

export function getDataStatus(): DataStatus {
  return readDataStatus(getDb(), JOBS)
}

/**
 * Once `scrub-secrets` is done, removes its secrets from the copies in the backups folder too. A command people typed
 * gives it a short budget; `upgrade` finishes every copy. Never fails the run: a copy that can't be scrubbed now is left
 * for the next one.
 */
function scrubOldBackups({ isTimeLimited }: { isTimeLimited: boolean }): void {
  try {
    const startedAt = Date.now()
    const result = scrubBackups(getDb(), {
      directory: BACKUPS_DIR,
      openDatabase: openDatabaseFile,
      isOverBudget: isTimeLimited ? () => Date.now() - startedAt >= BACKUP_SCRUB_BUDGET_MS : undefined,
    })
    if (result.scrubbed > 0) log.notice(`Removed secrets from ${result.scrubbed} of your Workscribe backups.`)
    if (result.unwritable.length > 0) log.notice(`${UNWRITABLE_NOTICE} ${result.unwritable.join(', ')}`)
  } catch (error) {
    debugLog('scrub-secrets: backups', error)
  }
}

/** Runs the pending data jobs on the real database, taking this version's backup first. */
export function runDataJobs(cliVersion: string, options: Omit<RunOptions, 'ensureBackup'> = {}): RunResult {
  const db = getDb()
  const result = runPendingJobs(db, JOBS, {
    ...options,
    ensureBackup: () => {
      const outcome = ensureBackup(db, {
        cliVersion,
        directory: BACKUPS_DIR,
        onCreate: () => log.notice(BACKUP_NOTICE),
      })
      if (outcome.status === 'busy') return 'busy'
      if (outcome.status === 'failed') {
        log.notice(`Couldn't back up your Workscribe data: ${outcome.error}`)
        return 'unavailable'
      }
      return 'ready'
    },
  })
  scrubOldBackups({ isTimeLimited: options.budgetMs !== undefined })
  return result
}

/**
 * Before an allowlisted command (see `shouldRunDataJobs`): records the version and gives pending data jobs a short
 * budget. Never fails the command — a job that couldn't run leaves every reader on its current path.
 */
export function runDataJobsBeforeCommand(command: string | undefined, cliVersion: string): void {
  try {
    recordCliVersion(getDb(), cliVersion)
    // `upgrade` runs the jobs itself, with no budget
    if (command === 'upgrade') return
    let hasNoticed = false
    runDataJobs(cliVersion, {
      budgetMs: IMPLICIT_RUN_BUDGET_MS,
      onProgress: ({ elapsedMs }) => {
        if (hasNoticed || elapsedMs < PROGRESS_NOTICE_AFTER_MS) return
        hasNoticed = true
        log.notice(PROGRESS_NOTICE)
      },
    })
  } catch (error) {
    log.notice(`Couldn't upgrade your Workscribe data: ${errorMessage(error)}`)
  }
}
