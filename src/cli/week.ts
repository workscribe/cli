import { Command } from 'commander'
import { getProvider } from '../ai/router'
import { readConfig } from '../config'
import { log } from '../utils/logger'
import { runWeeklySummary } from '../summary/weekly'

export function registerWeek(program: Command): void {
  program
    .command('week')
    .description('Generate an AI weekly digest (Mon–today)')
    .option('--fresh', 'bypass cache and regenerate')
    .option('--slack', 'post to Slack webhook from config')
    .option('--webhook <url>', 'post to a custom webhook URL')
    .action(async (options) => {
      const config = readConfig()
      let provider
      try {
        provider = getProvider(config)
      } catch (error) {
        log.error((error as Error).message)
        process.exit(1)
      }

      try {
        await runWeeklySummary({ options, config, provider, noun: 'digest' })
      } catch (error) {
        log.error((error as Error).message)
        process.exit(1)
      }
    })
}
