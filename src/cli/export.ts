import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import { getOrBuildSessions } from '../sessions/detector'
import { readConfig } from '../config'
import { log } from '../utils/logger'
import { todayDate, parseDate } from '../utils/format'
import { EXPORTS_DIR } from '../utils/paths'
import { buildDayPayload, locationContextFrom } from '../summary/payload'
import { createSummaryWriter } from '../summary/writer'
import { printLegacyAiNotice } from './notices'

export function registerExport(program: Command): void {
  program
    .command('export')
    .description('Export work summary as a markdown file')
    .option('--date <YYYY-MM-DD>', 'date to export (default: today)')
    .option('--output <path>', 'output file path (default: ~/.workscribe/exports/)')
    .action(async (options) => {
      const config = readConfig()
      printLegacyAiNotice(config)

      let date = todayDate()
      if (options.date) {
        try {
          date = parseDate(options.date)
        } catch (error) {
          log.error((error as Error).message)
          process.exit(1)
        }
      }

      const sessions = getOrBuildSessions(date)
      if (sessions.length === 0) {
        log.plain(`No activity captured for ${date}`)
        return
      }

      const payload = buildDayPayload(date, sessions, locationContextFrom(config))
      const summary = await createSummaryWriter(config).summarize(payload)

      const outputPath = options.output ?? path.join(EXPORTS_DIR, `workscribe-${date}.md`)

      if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true, mode: 0o700 })

      fs.writeFileSync(outputPath, `# Work Summary — ${date}\n\n${summary}\n`, { encoding: 'utf-8', mode: 0o600 })
      log.success(`Saved: ${outputPath}`)
    })
}
