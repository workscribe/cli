import { Command } from 'commander'
import chalk from 'chalk'
import { getOrBuildSessions } from '../sessions/detector'
import { readConfig } from '../config'
import { log } from '../utils/logger'
import { todayDate, parseDate } from '../utils/format'
import type { SessionPayload } from '../ai/types'
import { buildExcludedSet } from '../summary/exclusions'
import { formatSessionLabel } from '../summary/heading'
import { createSummaryWriter } from '../summary/writer'
import { printLegacyAiNotice } from './notices'
import { postSummary } from '../summary/webhook'
import { runWeeklySummary } from '../summary/weekly'
import { renderDay, type RenderedDay } from '../summary/day'
import { printExcludedFooter, printSavedNote } from './day-notes'

interface SessionSummaryJson {
  project: string | null
  branch: string | null
  durationMinutes: number
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

function toJsonOutput(date: string, sessionPayloads: SessionPayload[], bulletsPerSession: string[]): string {
  const sessions: SessionSummaryJson[] = sessionPayloads.map((sessionPayload, index) => ({
    project: sessionPayload.project,
    branch: sessionPayload.branch,
    durationMinutes: sessionPayload.durationMinutes,
    bullets: parseBullets(bulletsPerSession[index]),
  }))
  return JSON.stringify({ date, sessions }, null, 2)
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
  program
    .command('summary')
    .description('Generate a work summary')
    .option('--date <YYYY-MM-DD>', 'date to summarize (default: today)')
    .option('--week', 'summarize the current week')
    .option('--fresh', 'ignore saved summaries and render the template')
    .option('--verbose', 'show all captured events, including those left out of the summary')
    .option('--slack', 'post summary to Slack webhook from config')
    .option('--webhook <url>', 'post summary to a custom webhook URL')
    .action(async (options) => {
      const config = readConfig()
      printLegacyAiNotice(config)
      const provider = createSummaryWriter(config)

      // ── Weekly branch ────────────────────────────────────────────────────────
      if (options.week) {
        try {
          await runWeeklySummary({ options, config, provider })
        } catch (error) {
          log.error((error as Error).message)
          process.exit(1)
        }
        return
      }

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

      const sessions = getOrBuildSessions(date)

      if (sessions.length === 0) {
        log.plain(`No activity captured for ${date}`)
        return
      }

      const jsonMode = config.summary?.format === 'json'
      let day: RenderedDay
      try {
        day = await renderDay({ date, sessions, config, provider, fresh: options.fresh })
      } catch (error) {
        log.error(`Summary failed: ${(error as Error).message}`)
        process.exit(1)
      }
      const { sessionPayloads, saved, summaries, fullSummary, needsGeneration } = day
      const excluded = buildExcludedSet(config.summary?.includeCategories ?? [])
      if (needsGeneration && options.verbose) {
        if (jsonMode) log.notice('--verbose is skipped when summary.format is json, to keep the JSON output clean')
        else printCapturedEvents(sessionPayloads, excluded)
      }

      if (jsonMode) {
        // Only the JSON on stdout, so it can be piped straight into another tool
        log.plain(toJsonOutput(date, sessionPayloads, summaries.map(stripHeading)))
      } else {
        log.plain('')
        log.plain(fullSummary)
        log.plain('')
        printSavedNote(saved)
        if (needsGeneration) printExcludedFooter(sessionPayloads, excluded)
      }

      await postSummary({ options, config, summary: fullSummary, statusToStderr: jsonMode })
    })
}
