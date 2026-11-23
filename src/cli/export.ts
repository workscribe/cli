import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import { readConfig } from '../config'
import { log } from '../utils/logger'
import { todayDate, parseDate } from '../utils/format'
import { EXPORTS_DIR } from '../utils/paths'
import { renderDay, type RenderedDay } from '../summary/day'
import { buildExcludedSet } from '../summary/exclusions'
import { printExcludedFooter, printSavedNote } from './day-notes'
import { createSummaryWriter } from '../summary/writer'
import { printLegacyAiNotice } from './notices'
import { loadDayThreads, requireThreadData } from './thread-day'
import { renderKeptDay } from '../summary/kept'
import { keptSummariesOf } from './kept-day'

/** Writes the day's markdown to `output`, or to the exports folder, and says where. */
function writeExport(output: string | undefined, date: string, summary: string): void {
  const outputPath = output ?? path.join(EXPORTS_DIR, `workscribe-${date}.md`)
  if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true, mode: 0o700 })
  fs.writeFileSync(outputPath, `# Work Summary — ${date}\n\n${summary}\n`, { encoding: 'utf-8', mode: 0o600 })
  log.success(`Saved: ${outputPath}`)
}

export function registerExport(program: Command): void {
  program
    .command('export')
    .description('Export work summary as a markdown file')
    .option('--date <YYYY-MM-DD>', 'date to export (default: today)')
    .option('--output <path>', 'output file path (default: ~/.workscribe/exports/)')
    .option('--fresh', 'ignore saved summaries and render the template')
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

      requireThreadData()
      const blocks = loadDayThreads(date)
      if (blocks.length === 0) {
        // A day whose events were removed (WOR-179) still has the summaries saved for it
        const kept = keptSummariesOf(date)
        if (kept.length === 0) {
          log.plain(`No activity captured for ${date}`)
          return
        }
        writeExport(options.output, date, renderKeptDay(kept))
        return
      }

      // The same day `workscribe summary` shows, saved summaries included — always as markdown, whatever summary.format
      let day: RenderedDay
      try {
        day = await renderDay({ date, blocks, config, provider: createSummaryWriter(config), fresh: options.fresh })
      } catch (error) {
        log.error(`Export failed: ${(error as Error).message}`)
        process.exit(1)
      }

      writeExport(options.output, date, day.fullSummary)
      // Notes about the summary stay on the console, out of the file
      printSavedNote(day.saved)
      if (day.needsGeneration) {
        printExcludedFooter(day.sessionPayloads, buildExcludedSet(config.summary?.includeCategories ?? []))
      }
    })
}
