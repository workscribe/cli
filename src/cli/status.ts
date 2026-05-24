import { Command } from 'commander'
import chalk from 'chalk'
import { getEventCount, getLastEvent } from '../db'
import { readConfig } from '../config'
import { log } from '../utils/logger'
import { formatDate, todayDate } from '../utils/format'
import { getEventsForDate } from '../db'

export function registerStatus(program: Command): void {
  program
    .command('status')
    .description('Show capture status and event counts')
    .action(() => {
      const config = readConfig()
      const total = getEventCount()
      const todayEvents = getEventsForDate(todayDate())
      const last = getLastEvent()

      log.plain('')
      log.plain(chalk.bold('  Workscribe Status'))
      log.plain('')
      log.plain(`  Capture      ${chalk.green('active')}`)
      log.plain(`  Events today ${chalk.cyan(String(todayEvents.length))}`)
      log.plain(`  Events total ${chalk.cyan(String(total))}`)

      if (last) {
        log.plain(`  Last event   ${formatDate(last.captured_at)}  ${chalk.dim(last.command.slice(0, 60))}`)
      }

      log.plain('')
      log.plain(`  AI provider  ${config.ai.provider ? chalk.cyan(config.ai.provider) : chalk.yellow('not configured')}`)
      if (config.ai.model) log.plain(`  Model        ${chalk.dim(config.ai.model)}`)
      log.plain('')
    })
}
