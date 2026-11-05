import { Command } from 'commander'
import chalk from 'chalk'
import { readConfig } from '../config'
import { log } from '../utils/logger'
import { todayDate, parseDate } from '../utils/format'
import type { SessionPayload } from '../ai/types'
import { buildExcludedSet } from '../summary/exclusions'
import { formatSessionLabel } from '../summary/heading'
import { createSummaryWriter } from '../summary/writer'
import { printLegacyAiNotice } from './notices'
import { postSummary } from '../summary/webhook'
import { renderDay, type RenderedDay } from '../summary/day'
import { keepsStdoutClean } from '../summary/output-format'
import { toPlainText } from '../summary/plain-text'
import { printExcludedFooter, printSavedNote } from './day-notes'
import { loadDayThreads, requireThreadData } from './thread-day'
import { addSummaryFormatOption, addWeekLayoutOption, parseSummaryFormat, runWeekCommand } from './week'
import { fail } from './fail'

interface SessionSummaryJson {
  project: string | null
  branch: string | null
  /** The thread's span, first event to last */
  durationMinutes: number
  /** The thread's own active time */
  activeMinutes: number | null
  /** The other projects worked in its block */
  alongside: string[]
  bullets: string[]
}

/** Parse bullet output into a clean string array. Handles both - and • prefixes. */
export function parseBullets(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^[•\-]\s*/, '').trim())
    .filter(Boolean)
}

function stripHeading(summary: string): string {
  return summary.replace(/^## .+\n/, '')
}

function toJsonOutput(day: RenderedDay, date: string): string {
  const sessions: SessionSummaryJson[] = day.sessionPayloads.map((sessionPayload, index) => ({
    project: sessionPayload.project,
    branch: sessionPayload.branch,
    durationMinutes: sessionPayload.durationMinutes,
    activeMinutes: sessionPayload.activeMinutes ?? null,
    alongside: sessionPayload.alongside ?? [],
    bullets: parseBullets(stripHeading(day.summaries[index])),
  }))
  return JSON.stringify({ date, activeMinutes: day.activeMinutes, sessions }, null, 2)
}

function printCapturedEvents(sessionPayloads: SessionPayload[], excluded: Set<string>): void {
  log.plain('')
  log.plain(chalk.bold('  Captured events (--verbose):'))
  for (const sessionPayload of sessionPayloads) {
    log.plain(chalk.dim(`\n  ${formatSessionLabel(sessionPayload)}`))
    for (const event of sessionPayload.events) {
      const tag = excluded.has(event.category) ? chalk.dim(`  [excluded] ${event.category}`) : `  ${event.category}`
      const hint = event.hint ? chalk.dim(` [${event.hint}]`) : ''
      const meta = Object.keys(event.metadata).length > 0 ? chalk.dim(` ${JSON.stringify(event.metadata)}`) : ''
      log.plain(`    ${tag}${hint}${meta}`)
    }
  }
  log.plain('')
}

export function registerSummary(program: Command): void {
  const summaryCommand = program
    .command('summary')
    .description('Generate a work summary')
    .option('--date <YYYY-MM-DD>', 'date to summarize (default: today)')
    .option('--week', 'summarize the current week')
    .option('--fresh', 'ignore saved summaries and render the template')
    .option('--verbose', 'show all captured events, including those left out of the summary')
    .option('--slack', 'post summary to Slack webhook from config')
    .option('--webhook <url>', 'post summary to a custom webhook URL')
  addSummaryFormatOption(addWeekLayoutOption(summaryCommand)).action(async (options) => {
    if (options.by !== undefined && !options.week) fail('--by only applies to --week')
    const formatOption = parseSummaryFormat(options.format)
    // ── Weekly branch: the same handler as `workscribe week` ──────────────────
    if (options.week) {
      await runWeekCommand(options)
      return
    }

    const config = readConfig()
    printLegacyAiNotice(config)
    const provider = createSummaryWriter(config)

    requireThreadData()

    // ── Daily branch ─────────────────────────────────────────────────────────
    let date = todayDate()
    if (options.date) {
      try {
        date = parseDate(options.date)
      } catch (error) {
        log.error((error as Error).message)
        process.exit(1)
      }
    }

    const blocks = loadDayThreads(date)

    if (blocks.length === 0) {
      log.plain(`No activity captured for ${date}`)
      return
    }

    const format = formatOption ?? config.summary?.format
    const keepsStdoutToOutput = keepsStdoutClean(format)
    let day: RenderedDay
    try {
      day = await renderDay({ date, blocks, config, provider, fresh: options.fresh })
    } catch (error) {
      log.error(`Summary failed: ${(error as Error).message}`)
      process.exit(1)
    }
    const { sessionPayloads, saved, fullSummary, needsGeneration } = day
    const excluded = buildExcludedSet(config.summary?.includeCategories ?? [])
    if (needsGeneration && options.verbose) {
      if (keepsStdoutToOutput) log.notice(`--verbose is skipped with the ${format} format, to keep the output clean`)
      else printCapturedEvents(sessionPayloads, excluded)
    }

    if (format === 'json') {
      // Only the JSON on stdout, so it can be piped straight into another tool
      log.plain(toJsonOutput(day, date))
    } else if (format === 'text') {
      // Only the text on stdout, so it can be pasted with nothing to clean up
      log.plain(toPlainText(fullSummary))
    } else {
      log.plain('')
      log.plain(fullSummary)
      log.plain('')
      printSavedNote(saved)
      if (needsGeneration) printExcludedFooter(sessionPayloads, excluded)
    }

    await postSummary({ options, config, summary: fullSummary, statusToStderr: keepsStdoutToOutput })
  })
}
