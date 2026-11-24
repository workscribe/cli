import { readRetentionPolicy } from '../config'
import { getDb } from '../db'
import { JOBS } from '../db/jobs'
import { isFileCleanupPending, runFileCleanup } from '../db/retention-cleanup'
import { runRetention, type RetentionOutcome, type SkipReason } from '../db/retention-run'
import type { RemovalPreview } from '../db/retention-schedule'
import { KEEP_EVERYTHING_COMMAND } from '../config/retention'
import { removalCounts } from './retention-text'
import { BACKUPS_DIR } from '../utils/paths'
import { debugLog, log } from '../utils/logger'

// Runs the removal of old data (WOR-179) next to the data jobs. Never fails the command it runs before: a run that
// couldn't happen is tried again at the next one.

// A command people typed waits at most this long for removal, between batches; the rest carries on at the next command
const IMPLICIT_RETENTION_BUDGET_MS = 1500

function whatGoes(preview: RemovalPreview): string {
  if (preview.events === 0) return 'Nothing is old enough yet: it then removes one day at a time, the oldest first.'
  return `That removes ${removalCounts(preview)}.`
}

/** What happens to saved summaries: they have a limit of their own, none unless it is set. */
function summariesNote(summaryDays: number | null): string {
  return summaryDays === null
    ? 'Your summaries stay.'
    : `Saved summaries are removed after ${summaryDays} days (retention.summaryDays).`
}

function announcement(
  days: number,
  summaryDays: number | null,
  firstRemovalOn: string,
  preview: RemovalPreview
): string {
  return (
    `Workscribe now removes captured events older than ${days} days. The first removal is on ${firstRemovalOn}. ` +
    `${whatGoes(preview)} ${summariesNote(summaryDays)} To keep everything instead: ${KEEP_EVERYTHING_COMMAND}. Details: workscribe retention`
  )
}

function whenText(daysUntil: number): string {
  return daysUntil === 1 ? 'tomorrow' : `in ${daysUntil} days`
}

function reminder(days: number, firstRemovalOn: string, daysUntil: number, preview: RemovalPreview): string {
  return (
    `Workscribe removes captured events older than ${days} days ${whenText(daysUntil)}, on ${firstRemovalOn}. ` +
    `${whatGoes(preview)} To keep everything instead: ${KEEP_EVERYTHING_COMMAND}`
  )
}

/** Why nothing was removed, for the reasons a person can fix; the others (kept forever, already ran today) say nothing. */
function skippedMessage(reason: SkipReason): string | null {
  if (reason.kind === 'paused')
    return `Removing old data is paused until ${reason.job} has finished. Run workscribe upgrade.`
  if (reason.kind === 'unreadable') return `Nothing is removed: ${reason.reason}.`
  return null
}

/** What a run says. Quiet unless something happened that the person should know about. */
function report(outcome: RetentionOutcome, options: { isExplicit: boolean }): void {
  switch (outcome.status) {
    case 'announced':
      log.notice(announcement(outcome.days, outcome.summaryDays, outcome.firstRemovalOn, outcome.preview))
      return
    case 'waiting':
      if (outcome.reminder !== null) {
        log.notice(reminder(outcome.days, outcome.firstRemovalOn, outcome.daysUntil, outcome.reminder))
      }
      return
    case 'ran':
      if (outcome.events > 0) {
        log.notice(
          `Removed ${outcome.events} captured events older than ${outcome.days} days. ${summariesNote(outcome.summaryDays)}`
        )
      }
      if (outcome.summaries > 0)
        log.notice(`Removed ${outcome.summaries} saved summaries, as retention.summaryDays says.`)
      return
    case 'skipped': {
      const reason = options.isExplicit ? skippedMessage(outcome.reason) : null
      if (reason !== null) log.notice(reason)
    }
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

const warnAboutVacuum = (): void => {
  log.notice(VACUUM_NOTICE)
}

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
        beforeVacuum: warnAboutVacuum,
      }),
      { isExplicit: true }
    )
    // A cleanup left over from an earlier run, when this one removed nothing
    if (isFileCleanupPending(db)) runFileCleanup(db, { canVacuum: true, beforeVacuum: warnAboutVacuum })
  } catch (error) {
    debugLog('retention: run after an upgrade', error)
  }
}
