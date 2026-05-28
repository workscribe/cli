import { Command } from 'commander'
import chalk from 'chalk'
import { getOrBuildSessions } from '../sessions/detector'
import { log } from '../utils/logger'
import { todayDate, parseDate, formatDate, formatDuration } from '../utils/format'

export function registerSessions(program: Command): void {
  program
    .command('sessions')
    .description('List detected work sessions')
    .option('--date <YYYY-MM-DD>', 'date to show sessions for (default: today)')
    .action((opts) => {
      let date = todayDate()
      if (opts.date) {
        try {
          date = parseDate(opts.date)
        } catch (e) {
          log.error((e as Error).message)
          process.exit(1)
        }
      }

      const sessions = getOrBuildSessions(date)

      if (sessions.length === 0) {
        log.plain(`No sessions detected for ${date}`)
        return
      }

      log.plain('')
      log.plain(chalk.bold(`  Sessions for ${date}  (${sessions.length} session${sessions.length > 1 ? 's' : ''})`))
      log.plain('')

      for (const session of sessions) {
        const start = formatDate(session.startedAt)
        const end = formatDate(session.endedAt)
        const duration = formatDuration(session.durationMinutes)
        const repo = session.repoName ? chalk.cyan(session.repoName) : chalk.gray('no repo')
        log.plain(
          `  ${chalk.dim(start)} – ${chalk.dim(end)}  ${repo}  ${chalk.dim(duration)}  ${chalk.dim(session.eventCount + ' events')}`
        )
      }

      log.plain('')
    })
}
