import { Command } from 'commander'
import chalk from 'chalk'
import { getEventsForDate } from '../db'
import { log } from '../utils/logger'
import { todayDate, parseDate, formatDate } from '../utils/format'

const CATEGORY_COLORS: Record<string, (s: string) => string> = {
  code_commit: chalk.green,
  code_push: chalk.green,
  code_pull: chalk.blue,
  branch_switch: chalk.blue,
  dependency_install: chalk.yellow,
  dependency_remove: chalk.yellow,
  test_run: chalk.magenta,
  build: chalk.cyan,
  server_run: chalk.cyan,
  infrastructure: chalk.red,
  script_run: chalk.white,
  environment: chalk.gray,
  git_other: chalk.blue,
  code_merge: chalk.green,
  code_stash: chalk.blue,
  ai_session: chalk.magenta,
  other: chalk.gray,
}

export function registerEvents(program: Command): void {
  program
    .command('events')
    .description('List captured events')
    .option('--date <YYYY-MM-DD>', 'date to list events for (default: today)')
    .option('--limit <n>', 'max events to show', parseInt)
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

      const events = getEventsForDate(date)
      const limit = opts.limit ?? events.length

      if (events.length === 0) {
        log.plain(`No events captured for ${date}`)
        return
      }

      log.plain('')
      log.plain(chalk.bold(`  Events for ${date}  (${events.length} total)`))
      log.plain('')

      for (const event of events.slice(0, limit)) {
        const colorFn = CATEGORY_COLORS[event.category] ?? chalk.gray
        const time = formatDate(event.captured_at)
        const category = colorFn(event.category.padEnd(20))
        const cmd = chalk.dim(event.command.slice(0, 55))
        const repo = event.repo_name ? chalk.dim(` [${event.repo_name}]`) : ''
        const exitBadge = event.exit_code && event.exit_code !== 0 ? chalk.red(` ✗${event.exit_code}`) : ''
        log.plain(`  ${chalk.dim(time)}  ${category}  ${cmd}${repo}${exitBadge}`)
      }

      if (limit < events.length) {
        log.plain('')
        log.plain(chalk.dim(`  … and ${events.length - limit} more (remove --limit to see all)`))
      }

      log.plain('')
    })
}
