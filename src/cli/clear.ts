import { Command } from 'commander'
import chalk from 'chalk'
import prompts from 'prompts'
import { getEventsForDate, deleteEventsForDate } from '../db'
import { log } from '../utils/logger'
import { todayDate, parseDate } from '../utils/format'

export function registerClear(program: Command): void {
  program
    .command('clear')
    .description('Delete all captured events for a date')
    .option('--date <YYYY-MM-DD>', 'date to clear (default: today)')
    .option('--dry-run', 'preview what would be deleted without deleting')
    .option('--yes', 'skip confirmation prompt')
    .action(async (opts) => {
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

      if (events.length === 0) {
        log.plain(`No events found for ${date}.`)
        return
      }

      log.plain('')
      log.plain(chalk.bold(`  Events for ${date}  (${events.length} total)`))
      log.plain('')

      // Show a compact summary by category
      const counts = new Map<string, number>()
      for (const e of events) counts.set(e.category, (counts.get(e.category) ?? 0) + 1)
      for (const [cat, n] of counts) {
        log.plain(`  ${chalk.dim(String(n).padStart(4))}  ${cat}`)
      }
      log.plain('')

      if (opts.dryRun) {
        log.plain(chalk.dim('  Dry run — nothing deleted.'))
        log.plain('')
        return
      }

      if (!opts.yes) {
        const { confirm } = await prompts({
          type: 'confirm',
          name: 'confirm',
          message: `Delete all ${events.length} events for ${date}?`,
          initial: false,
        })
        if (!confirm) {
          log.plain('Cancelled.')
          return
        }
      }

      const deleted = deleteEventsForDate(date)
      log.success(`Cleared ${deleted} event${deleted !== 1 ? 's' : ''} for ${date}.`)
    })
}
