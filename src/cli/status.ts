import { Command } from 'commander'
import fs from 'fs'
import chalk from 'chalk'
import { getEventCount, getLastEvent, getRecentOtherRate } from '../db'
import { readConfig } from '../config'
import { log } from '../utils/logger'
import { formatDate, todayDate } from '../utils/format'
import { getEventsForDate } from '../db'
import { PAUSE_FLAG_PATH } from '../utils/paths'
import { getPendingAlerts } from '../db/alerts'
import { AI_HOOK_INTEGRATIONS } from '../capture/hooks'
import type { AIHookIntegration } from '../capture/hooks/types'
import { detectShell, shellHookHealth } from '../capture/shell-hook'
import { detectAgents } from '../skills/detect'
import { formatAgentSkillLine } from '../skills/actions'
import { printLegacyAiNotice } from './notices'
import { getDataStatus } from './data-jobs'
import { currentRetentionStatus, retentionStatusLine } from './retention'
import type { DataStatus } from '../db/jobs/state'

// Labelled on the first agent's row only, like the other status sections
const AGENT_SKILL_LABEL = 'Agent skill'

function describeDataState(status: DataStatus): string {
  if (status.failed) {
    return `${chalk.red(`upgrade failed: ${status.failed.name}`)}  ${chalk.dim('(run: workscribe upgrade)')}`
  }
  if (status.failedChecks.length > 0) {
    return `${chalk.red(`upgrade check failed: ${status.failedChecks.join(', ')}`)}  ${chalk.dim('(run: workscribe bug-report)')}`
  }
  if (status.pending.length > 0) {
    const count = status.pending.length
    return `${chalk.yellow(`${count} upgrade${count === 1 ? '' : 's'} pending`)}  ${chalk.dim('(run: workscribe upgrade)')}`
  }
  return chalk.green('up to date')
}

/** The "Data" line: data jobs pending, failed or failing their check, unresolved rows, and the latest backup. */
export function formatDataLines(status: DataStatus): string[] {
  const lines = [`  Data         ${describeDataState(status)}`]
  const { unresolvedRows } = status
  if (unresolvedRows > 0) {
    lines.push(chalk.dim(`               ${unresolvedRows} row${unresolvedRows === 1 ? '' : 's'} left unresolved`))
  }
  if (status.latestBackup) lines.push(chalk.dim(`               backup: ${status.latestBackup}`))
  return lines
}

/** An old shell hook (one that can drop terminal commands), or a leftover 0.2.1 Chronicle hook in the rc file. */
function printShellHookWarnings(): void {
  const shell = detectShell()
  if (!shell) return
  const health = shellHookHealth(shell)
  if (health.isOutdated) {
    log.plain('')
    log.plain(
      `  ${chalk.yellow('⚠')}  Your ${shell.name} hook is from an older version and may not record terminal commands.`
    )
    log.plain(chalk.dim('     Run workscribe init to update it, then open a new terminal'))
  }
  if (health.hasChronicleHook) {
    log.plain('')
    log.plain(`  ${chalk.yellow('⚠')}  An old Chronicle hook in ${shell.rcFile} errors at every prompt.`)
    log.plain(chalk.dim('     Run workscribe init to remove it'))
  }
}

/** What's wrong with an agent's installed hook, if anything: one warning with what to do about it. */
function printAgentHookWarning(integration: AIHookIntegration): void {
  const health = integration.checkHealth()
  const name = integration.displayName
  const warn = (message: string, fix: string): void => {
    log.plain('')
    log.plain(`  ${chalk.yellow('⚠')}  ${message}`)
    log.plain(chalk.dim(`     ${fix}`))
  }
  if (health.installed && !health.pinned) {
    warn(
      health.confirmedBroken
        ? `${name} hook is using an unpinned command and is failing right now — ${name} activity is not being captured.`
        : `${name} hook is using an unpinned command, which can silently break if your default Node version changes.`,
      'Run workscribe init to repair it'
    )
  } else if (health.installed && health.nodeMissing) {
    warn(
      `The Node.js version the ${name} hook uses is gone — ${name} activity is not being captured.`,
      'Run workscribe init to repair it'
    )
  } else if (health.installed && !health.guarded) {
    warn(
      `${name} hook is from an older version — it will show errors in ${name} if Workscribe is ever removed.`,
      'Run workscribe init to update it'
    )
  }
}

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show capture status and event counts')
    .action(() => {
      const config = readConfig()
      printLegacyAiNotice(config)
      const total = getEventCount()
      const todayEvents = getEventsForDate(todayDate())
      const last = getLastEvent()
      const isPaused = fs.existsSync(PAUSE_FLAG_PATH)

      log.plain('')
      log.plain(chalk.bold('  Workscribe Status'))
      log.plain('')

      if (isPaused) {
        log.plain(`  Capture      ${chalk.yellow('paused')}  ${chalk.dim('(run: workscribe resume)')}`)
      } else {
        log.plain(`  Capture      ${chalk.green('active')}`)
      }

      const [firstExcluded, ...otherExcluded] = config.capture.excludePaths ?? []
      if (firstExcluded) {
        log.plain(`  Excluded     ${firstExcluded}`)
        for (const excludedPath of otherExcluded) log.plain(`               ${excludedPath}`)
      }

      log.plain(`  Events today ${chalk.cyan(String(todayEvents.length))}`)
      log.plain(`  Events total ${chalk.cyan(String(total))}`)

      if (last) {
        log.plain(`  Last event   ${formatDate(last.captured_at)}  ${chalk.dim(last.command.slice(0, 60))}`)
      }

      log.plain('')
      const agents = detectAgents()
      const skillHint = agents.length > 0 ? ' · AI-written ones via the agent skill below' : ''
      log.plain(`  Summaries    ${chalk.cyan('template')} ${chalk.dim(`(offline)${skillHint}`)}`)

      const activeProfiles = config.capture.profiles
      log.plain(
        `  Profiles     ${activeProfiles.length > 0 ? chalk.cyan(activeProfiles.join(', ')) : chalk.dim('none')}`
      )

      log.plain(retentionStatusLine(currentRetentionStatus()))
      for (const line of formatDataLines(getDataStatus())) log.plain(line)

      agents.forEach((agent, index) => {
        const label = index === 0 ? AGENT_SKILL_LABEL : ''
        log.plain(`  ${label.padEnd(AGENT_SKILL_LABEL.length)}  ${formatAgentSkillLine(agent)}`)
      })

      const pendingAlerts = getPendingAlerts()
      if (pendingAlerts.length > 0) {
        log.plain('')
        log.plain(
          `  ${chalk.yellow('!')}  ${chalk.yellow(String(pendingAlerts.length))} pending security alert${pendingAlerts.length === 1 ? '' : 's'}` +
            chalk.dim('  (run: workscribe alerts)')
        )
      }

      printShellHookWarnings()

      for (const integration of Object.values(AI_HOOK_INTEGRATIONS)) printAgentHookWarning(integration)

      const { total: weekTotal, otherCount } = getRecentOtherRate(7)
      if (weekTotal > 0) {
        const otherPct = Math.round((otherCount / weekTotal) * 100)
        if (otherPct >= 25) {
          log.plain('')
          log.plain(
            `  ${chalk.yellow('⚠')}  ${otherCount} of ${weekTotal} events (${otherPct}%) are uncategorised this week.`
          )
          log.plain(
            chalk.dim(
              '     Run workscribe profile detect  — scan current directory for matching profiles\n' +
                '     Run workscribe profile suggest  — analyse your command history'
            )
          )
        }
      }

      log.plain('')
    })
}
