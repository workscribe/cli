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
import { checkHookHealth } from '../capture/hooks/claude-code'

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show capture status and event counts')
    .action(() => {
      const config = readConfig()
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

      log.plain(`  Events today ${chalk.cyan(String(todayEvents.length))}`)
      log.plain(`  Events total ${chalk.cyan(String(total))}`)

      if (last) {
        log.plain(`  Last event   ${formatDate(last.captured_at)}  ${chalk.dim(last.command.slice(0, 60))}`)
      }

      log.plain('')
      log.plain(
        `  AI provider  ${config.ai.provider ? chalk.cyan(config.ai.provider) : chalk.yellow('not configured')}`
      )
      if (config.ai.model) log.plain(`  Model        ${chalk.dim(config.ai.model)}`)

      const activeProfiles = config.capture.profiles
      log.plain(
        `  Profiles     ${activeProfiles.length > 0 ? chalk.cyan(activeProfiles.join(', ')) : chalk.dim('none')}`
      )

      const pendingAlerts = getPendingAlerts()
      if (pendingAlerts.length > 0) {
        log.plain('')
        log.plain(
          `  ${chalk.yellow('!')}  ${chalk.yellow(String(pendingAlerts.length))} pending security alert${pendingAlerts.length === 1 ? '' : 's'}` +
            chalk.dim('  (run: workscribe alerts)')
        )
      }

      const hookHealth = checkHookHealth()
      if (hookHealth.installed && !hookHealth.pinned) {
        log.plain('')
        if (hookHealth.confirmedBroken) {
          log.plain(
            `  ${chalk.yellow('⚠')}  Claude Code hook is using an unpinned command and is failing right now — Claude Code activity is not being captured.`
          )
        } else {
          log.plain(
            `  ${chalk.yellow('⚠')}  Claude Code hook is using an unpinned command, which can silently break if your default Node version changes.`
          )
        }
        log.plain(chalk.dim('     Run workscribe init to repair it'))
      }

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
