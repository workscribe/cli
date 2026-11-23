import { Command } from 'commander'
import chalk from 'chalk'
import { log } from '../utils/logger'
import type { JobRunResult, RunResult } from '../db/jobs/runner'
import { getDataStatus, runDataJobs } from './data-jobs'
import { runRetentionAfterUpgrade } from './retention-run'

declare const __WORKSCRIBE_VERSION__: string

function printVerification(result: JobRunResult): void {
  const { verification } = result
  if (!verification) return
  const counts = `checked ${verification.checked}, resolved ${verification.resolved}, unresolved ${verification.unresolved}`
  const line = `${result.name} (v${result.version}) — ${counts}`
  if (verification.hasPassed) log.success(line)
  else log.error(`${line} — check failed`)
  for (const note of verification.notes) log.plain(`    ${chalk.dim(note)}`)
}

function printResult(result: JobRunResult): void {
  if (result.outcome === 'failed') {
    log.error(`${result.name} failed: ${result.error ?? 'unknown error'} — run \`workscribe upgrade\` again to retry`)
    return
  }
  if (result.outcome === 'paused') {
    const reason = result.error ?? 'another Workscribe process is using the database — run `workscribe upgrade` again'
    log.warn(`${result.name} paused: ${reason}`)
    return
  }
  printVerification(result)
}

function hasSucceeded(result: JobRunResult): boolean {
  return result.outcome === 'done' && result.verification?.hasPassed !== false
}

/** A check that failed on an earlier run stays failed: rerunning can't bring missing data back, the backup can. */
function reportFailedChecks(failedChecks: string[], latestBackup: string | null): void {
  log.error(`The check after upgrading ${failedChecks.join(', ')} didn't pass — some data may not have carried over.`)
  if (latestBackup) log.plain(chalk.dim(`  Your data from before the upgrade is in ${latestBackup}`))
  log.plain(chalk.dim('  Run `workscribe bug-report` so it can be fixed.'))
}

/** Prints what the run did and returns whether the data is now fully up to date, with every check passing. */
function reportRun(result: RunResult): boolean {
  if (result.backup === 'busy') {
    log.warn(
      'Another Workscribe command is backing up your data right now. Run `workscribe upgrade` again in a moment.'
    )
    return false
  }
  if (result.backup === 'unavailable') {
    log.error("Couldn't back up your data, so nothing was changed. Run `workscribe upgrade` again to retry.")
    return false
  }

  result.jobs.forEach(printResult)
  const { latestBackup, pending, failedChecks } = getDataStatus()
  if (failedChecks.length > 0) {
    reportFailedChecks(failedChecks, latestBackup)
    return false
  }
  if (result.backup === 'not-needed') {
    log.success('Your Workscribe data is up to date.')
    return true
  }
  if (latestBackup) log.plain(chalk.dim(`  Backup: ${latestBackup}`))
  return pending.length === 0 && result.jobs.every(hasSucceeded)
}

export function registerUpgrade(program: Command): void {
  program
    .command('upgrade')
    .description('Bring your stored data up to date after updating Workscribe (backs it up first)')
    .action(() => {
      const announced = new Set<string>()
      const result = runDataJobs(__WORKSCRIBE_VERSION__, {
        onProgress: ({ job }) => {
          if (announced.has(job.name)) return
          announced.add(job.name)
          log.info(`Upgrading: ${job.description}`)
        },
      })
      const isUpToDate = reportRun(result)
      // Once the jobs are done, so removal never gets ahead of the summaries they prepare
      if (isUpToDate) runRetentionAfterUpgrade()
      if (!isUpToDate) process.exit(1)
    })
}
