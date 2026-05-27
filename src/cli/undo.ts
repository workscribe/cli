import { Command } from 'commander'
import { getLastEventIds, getEventsByIds, deleteEventsByIds } from '../db'
import { log } from '../utils/logger'

export function registerUndo(program: Command): void {
  program
    .command('undo')
    .description('Remove the last N captured events')
    .option('-n, --count <number>', 'number of events to remove', '1')
    .option('--dry-run', 'preview what would be deleted without deleting')
    .action((opts) => {
      const count = parseInt(opts.count, 10)
      if (isNaN(count) || count < 1) {
        log.error('--count must be a positive integer')
        process.exit(1)
      }

      const ids = getLastEventIds(count)
      if (ids.length === 0) {
        log.plain('No events to undo.')
        return
      }

      const events = getEventsByIds(ids)
      log.plain('')
      log.plain(`Events to remove (${events.length}):`)
      for (const e of events) {
        log.plain(`  ${e.captured_at}  ${e.category}  ${e.command}`)
      }
      log.plain('')

      if (opts.dryRun) {
        log.plain('Dry run — nothing deleted.')
        return
      }

      deleteEventsByIds(ids)
      log.success(`Removed ${ids.length} event${ids.length > 1 ? 's' : ''}.`)
    })
}
