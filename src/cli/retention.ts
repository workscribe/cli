import { Command } from 'commander'
import chalk from 'chalk'
import { readRetentionPolicy } from '../config'
import { KEEP_EVERYTHING_COMMAND } from '../config/retention'
import { removalCounts } from './retention-text'
import { getDb } from '../db'
import { JOBS } from '../db/jobs'
import { isFileCleanupPending } from '../db/retention-cleanup'
import { runRetention, type RetentionOutcome } from '../db/retention-run'
import { retentionStatusOf, type RetentionStatus } from '../db/retention-status'
import { BACKUPS_DIR } from '../utils/paths'
import { log } from '../utils/logger'

// `workscribe retention` (WOR-179): what is kept and for how long, the oldest day kept and when it goes, and what the
// next removal takes. `retention run` does the removal now, with no time limit.

const LABEL_WIDTH = 13

const labelled = (label: string, value: string): string => `  ${label.padEnd(LABEL_WIDTH)}${value}`

function eventsLine(status: RetentionStatus): string {
  if (status.mode === 'keep-forever') return `${chalk.cyan('kept forever')} ${chalk.dim('(retention.keepForever)')}`
  if (status.mode === 'unreadable') {
    return `${chalk.yellow('nothing is removed')} ${chalk.dim(`(${status.reason ?? 'the config can not be read'})`)}`
  }
  return `kept ${chalk.cyan(String(status.days))} days, then removed ${chalk.dim('(retention.days)')}`
}

function summariesLine(status: RetentionStatus): string {
  if (status.summaryDays === null) return `kept until you remove them ${chalk.dim('(retention.summaryDays: none)')}`
  return `removed after ${chalk.cyan(String(status.summaryDays))} days ${chalk.dim('(retention.summaryDays)')}`
}

function nextLine(status: RetentionStatus): string | null {
  if (status.next === null) return null
  const { on, ...preview } = status.next
  return preview.events === 0 ? `${on}: nothing is old enough yet` : `${on}: ${removalCounts(preview)}`
}

/** The whole picture, for `workscribe retention`. */
export function retentionLines(status: RetentionStatus): string[] {
  const lines = [labelled('Events', eventsLine(status)), labelled('Summaries', summariesLine(status))]
  if (status.mode === 'paused') {
    lines.push(labelled('Paused', chalk.yellow(`until ${status.pausedBy} has finished: run workscribe upgrade`)))
  }
  if (status.oldestDay !== null && status.oldestDayRemovedOn !== null) {
    lines.push(labelled('Oldest day', `${status.oldestDay}, removed on ${status.oldestDayRemovedOn}`))
  }
  if (status.startsOn !== null && status.mode === 'waiting') lines.push(labelled('Starts', status.startsOn))
  const next = nextLine(status)
  if (next !== null) lines.push(labelled('Next removal', next))
  if (status.mode !== 'keep-forever') lines.push('', chalk.dim(`  To keep everything: ${KEEP_EVERYTHING_COMMAND}`))
  return lines
}

function statusLineValue(status: RetentionStatus): string {
  if (status.mode === 'keep-forever') return chalk.cyan('kept forever')
  if (status.mode === 'unreadable') return `${chalk.yellow('nothing is removed')} ${chalk.dim('(config unreadable)')}`
  if (status.mode === 'paused') {
    return `${chalk.yellow('paused')} ${chalk.dim(`(until ${status.pausedBy} finishes: workscribe upgrade)`)}`
  }
  const oldest = status.oldestDayRemovedOn === null ? '' : ` · oldest day goes ${status.oldestDayRemovedOn}`
  return `${chalk.cyan(String(status.days))} days${chalk.dim(oldest)}`
}

/** One line for `status`. */
export function retentionStatusLine(status: RetentionStatus): string {
  return labelled('Retention', statusLineValue(status))
}

export function currentRetentionStatus(): RetentionStatus {
  return retentionStatusOf(getDb(), { now: new Date(), policy: readRetentionPolicy(), jobs: JOBS })
}

function reportRun(outcome: RetentionOutcome): void {
  if (outcome.status === 'ran') {
    log.success(`Removed ${outcome.events} captured events and ${outcome.backupsRemoved} old backups.`)
    if (outcome.summaries > 0) log.success(`Removed ${outcome.summaries} saved summaries.`)
    if (outcome.stoppedBecause === 'locked') log.warn('Stopped: another Workscribe command was writing. Run it again.')
    return
  }
  if (outcome.status === 'waiting' || outcome.status === 'announced') {
    log.info(`Removal starts on ${outcome.firstRemovalOn}. Nothing is removed before then.`)
    return
  }
  const { reason } = outcome
  if (reason.kind === 'keep-forever') log.info('Nothing is removed: retention.keepForever is on.')
  if (reason.kind === 'unreadable') log.warn(`Nothing is removed: ${reason.reason}.`)
  if (reason.kind === 'paused') log.warn(`Paused until ${reason.job} has finished. Run workscribe upgrade.`)
  if (reason.kind === 'throttled') log.info('Already ran today.')
}

export function registerRetention(program: Command): void {
  const retention = program
    .command('retention')
    .description('Show how long captured data is kept, and what the next removal takes')
    .action(() => {
      log.plain('')
      log.plain(chalk.bold('  Workscribe Retention'))
      log.plain('')
      for (const line of retentionLines(currentRetentionStatus())) log.plain(line)
      log.plain('')
    })

  retention
    .command('run')
    .description('Remove the data older than the limit now, with no time limit')
    .action(() => {
      const db = getDb()
      const outcome = runRetention(db, {
        now: new Date(),
        policy: readRetentionPolicy(),
        jobs: JOBS,
        backupsDirectory: BACKUPS_DIR,
        canVacuum: false,
        ignoreThrottle: true,
      })
      reportRun(outcome)
      if (isFileCleanupPending(db)) {
        log.info('Run workscribe upgrade to finish clearing the removed text from the database file.')
      }
    })
}
