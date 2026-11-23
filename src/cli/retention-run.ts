import { readRetentionPolicy } from '../config'
import { getDb } from '../db'
import { JOBS } from '../db/jobs'
import { isVacuumPending, isFileCleanupPending, runFileCleanup } from '../db/retention-cleanup'
import { runRetention, type RetentionOutcome, type SkipReason } from '../db/retention-run'
import { BACKUPS_DIR } from '../utils/paths'
import { debugLog, log } from '../utils/logger'

// Runs the removal of old data (WOR-179) next to the data jobs. Never fails the command it runs before: a run that
// couldn't happen is tried again at the next one.

// A command people typed waits at most this long for removal, between batches; the rest carries on at the next command
export const IMPLICIT_RETENTION_BUDGET_MS = 1500

const KEEP_EVERYTHING = 'workscribe config set retention.keepForever true'

function announcement(days: number, firstRemovalOn: string): string {
  return (
    `Workscribe now removes captured events older than ${days} days. The first removal is on ${firstRemovalOn}; ` +
    `your summaries stay. To keep everything instead: ${KEEP_EVERYTHING}. Details: workscribe retention`
  )
}

function pausedMessage(reason: SkipReason): string | null {
  if (reason.kind !== 'paused') return null
  return `Removing old data is paused until ${reason.job} has finished. Run workscribe upgrade.`
}

/** What a run says. Quiet unless something happened that the person should know about. */
function report(outcome: RetentionOutcome, options: { isExplicit: boolean }): void {
  if (outcome.status === 'announced') log.notice(announcement(outcome.days, outcome.firstRemovalOn))
  if (outcome.status === 'ran' && outcome.events > 0) {
    log.notice(`Removed ${outcome.events} captured events older than ${outcome.days} days. Your summaries stay.`)
  }
  if (outcome.status === 'skipped' && options.isExplicit) {
    const paused = pausedMessage(outcome.reason)
    if (paused !== null) log.notice(paused)
  }
}

/** Before a data command people typed: a short, time-limited run. Never the VACUUM, which blocks captures. */
export function runRetentionBeforeCommand(): void {
  try {
    const startedAt = Date.now()
    const outcome = runRetention(getDb(), {
      now: new Date(),
      policy: readRetentionPolicy(),
      jobs: JOBS,
      backupsDirectory: BACKUPS_DIR,
      isOverBudget: () => Date.now() - startedAt >= IMPLICIT_RETENTION_BUDGET_MS,
      canVacuum: false,
    })
    report(outcome, { isExplicit: false })
  } catch (error) {
    debugLog('retention: run before a command', error)
  }
}

const VACUUM_NOTICE =
  'Clearing removed text from the database file. Captures made while this runs, which can take a while on a large ' +
  'database, may be lost.'

/** After `workscribe upgrade`'s data jobs: no time limit, and the one VACUUM that rewrites the file may run. */
export function runRetentionAfterUpgrade(): void {
  try {
    const db = getDb()
    report(
      runRetention(db, {
        now: new Date(),
        policy: readRetentionPolicy(),
        jobs: JOBS,
        backupsDirectory: BACKUPS_DIR,
        canVacuum: true,
      }),
      { isExplicit: true }
    )
    if (!isFileCleanupPending(db)) return
    if (isVacuumPending(db)) log.notice(VACUUM_NOTICE)
    runFileCleanup(db, { canVacuum: true })
  } catch (error) {
    debugLog('retention: run after an upgrade', error)
  }
}
