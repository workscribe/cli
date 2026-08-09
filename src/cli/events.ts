import { Command } from 'commander'
import chalk from 'chalk'
import { getEventsForDate } from '../db'
import { log } from '../utils/logger'
import { todayDate, parseDate, formatDate } from '../utils/format'
import { loadAIToolRegistry } from '../config/registry'

const CATEGORY_COLORS: Record<string, (s: string) => string> = {
  shipping: chalk.green,
  versioning: chalk.blue,
  building: chalk.cyan,
  running: chalk.white,
  testing: chalk.magenta,
  linting: chalk.yellow,
  dependencies: chalk.yellow,
  infrastructure: chalk.red,
  releasing: chalk.bold.green,
  database: chalk.bold.blue,
  files: chalk.dim.yellow,
  exploring: chalk.dim.cyan,
  ai_session: chalk.bold.magenta,
  other: chalk.gray,
}

const AI_TOOL_DISPLAY_NAMES: Record<string, string> = Object.fromEntries(
  loadAIToolRegistry().map((entry) => [entry.tool, entry.displayName])
)

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
        const repo = event.repo_name ? chalk.dim(` [${event.repo_name}]`) : ''
        const exitBadge = event.exit_code && event.exit_code !== 0 ? chalk.red(` ✗${event.exit_code}`) : ''

        let cmdDisplay: string
        if (event.category === 'ai_session') {
          let meta: Record<string, unknown> = {}
          try {
            meta = event.metadata ? (JSON.parse(event.metadata) as Record<string, unknown>) : {}
          } catch {
            /* ignore */
          }
          const toolKey = typeof meta.tool === 'string' ? meta.tool : ''
          const toolName = AI_TOOL_DISPLAY_NAMES[toolKey] ?? toolKey
          cmdDisplay = chalk.white(toolName.padEnd(20)) + chalk.magenta(' ✦')
        } else {
          cmdDisplay = chalk.dim(event.command.slice(0, 55))
        }

        log.plain(`  ${chalk.dim(time)}  ${category}  ${cmdDisplay}${repo}${exitBadge}`)
      }

      if (limit < events.length) {
        log.plain('')
        log.plain(chalk.dim(`  … and ${events.length - limit} more (remove --limit to see all)`))
      }

      log.plain('')
    })
}
