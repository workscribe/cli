import { Command } from 'commander'
import { readConfig } from '../config'
import { log } from '../utils/logger'
import { runWeeklySummary } from '../summary/weekly'
import { createSummaryWriter } from '../summary/writer'
import { printLegacyAiNotice } from './notices'
import { loadDayThreads, requireThreadData } from './thread-day'

export function registerWeek(program: Command): void {
  program
    .command('week')
    .description('Generate a weekly digest (Mon–today)')
    .option('--fresh', 'accepted for 1.x scripts — digests are always rendered fresh')
    .option('--slack', 'post to Slack webhook from config')
    .option('--webhook <url>', 'post to a custom webhook URL')
    .action(async (options) => {
      const config = readConfig()
      printLegacyAiNotice(config)
      requireThreadData()
      try {
        await runWeeklySummary({ options, config, provider: createSummaryWriter(config), loadDay: loadDayThreads })
      } catch (error) {
        log.error((error as Error).message)
        process.exit(1)
      }
    })
}
