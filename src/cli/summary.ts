import { Command } from 'commander'
import chalk from 'chalk'
import { getOrBuildSessions } from '../sessions/detector'
import { readConfig } from '../config'
import { getSessionSummaries } from '../db'
import { log } from '../utils/logger'
import { todayDate, parseDate } from '../utils/format'
import type { AIProvider, DaySummaryPayload, SessionPayload } from '../ai/types'
import { buildExcludedSet, countExcludedEvents } from '../summary/exclusions'
import { sessionToPayload, locationContextFrom } from '../summary/payload'
import { formatSessionHeading, formatSessionLabel } from '../summary/heading'
import { sessionKey, pickSavedSummary, type SavedSummary } from '../summary/store'
import { createSummaryWriter } from '../summary/writer'
import { printLegacyAiNotice } from './notices'
import { postSummary } from '../summary/webhook'
import { runWeeklySummary } from '../summary/weekly'

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

function printExcludedFooter(sessionPayloads: SessionPayload[], excluded: Set<string>): void {
  const excludedCounts = countExcludedEvents(sessionPayloads, excluded)
  if (excludedCounts.size === 0) return
  const total = [...excludedCounts.values()].reduce((sum, count) => sum + count, 0)
  const breakdown = [...excludedCounts.entries()].map(([category, count]) => `${category} ×${count}`).join(', ')
  log.plain(chalk.dim(`  ℹ ${total} event${total === 1 ? '' : 's'} not included in summary (${breakdown})`))
  log.plain(chalk.dim('    Use --verbose to inspect · workscribe config set summary.includeCategories to opt in'))
  log.plain('')
}

async function generateSessionSummary(input: {
  provider: AIProvider
  sessionPayload: SessionPayload
  date: string
}): Promise<string> {
  const daySummaryPayload: DaySummaryPayload = { date: input.date, sessions: [input.sessionPayload] }
  try {
    const bullets = (await input.provider.summarize(daySummaryPayload)).trim()
    return `${formatSessionHeading(input.sessionPayload)}\n${bullets}`
  } catch (error) {
    log.error(`Summary failed: ${(error as Error).message}`)
    process.exit(1)
  }
}

/** Says which sessions came from saved summaries, so it's clear why --fresh would change the output. */
function printSavedNote(saved: (SavedSummary | null)[]): void {
  const fromSkill = saved.filter((entry) => entry?.fromSkill).length
  const fromLegacyProvider = saved.filter((entry) => entry && !entry.fromSkill).length
  const parts = [
    fromSkill > 0 ? `${fromSkill} written by the Workscribe agent skill` : null,
    fromLegacyProvider > 0 ? `${fromLegacyProvider} written by an AI provider in Workscribe 1.x` : null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return
  log.plain(chalk.dim(`  (${parts.join(', ')} — use --fresh for the template summary)`))
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

      const sessionPayloads = sessions.map((session) => sessionToPayload(session, date, locationContextFrom(config)))
      const keys = sessions.map((session) => sessionKey(session.repoName, session.startedAt))
      const jsonMode = config.summary?.format === 'json'

      // A summary the agent skill (or a 1.x AI provider) saved — `--fresh` ignores both and renders the template
      const saved = keys.map((key) => (options.fresh ? null : pickSavedSummary(getSessionSummaries(key))))
      const needsGeneration = saved.some((entry) => entry === null)
      const excluded = buildExcludedSet(config.summary?.includeCategories ?? [])
      if (needsGeneration && options.verbose) {
        if (jsonMode) log.notice('--verbose is skipped when summary.format is json, to keep the JSON output clean')
        else printCapturedEvents(sessionPayloads, excluded)
      }

      const summaries: string[] = []
      for (const [index, sessionPayload] of sessionPayloads.entries()) {
        const savedSummary = saved[index]
        if (savedSummary) {
          summaries.push(savedSummary.text)
          continue
        }
        summaries.push(await generateSessionSummary({ provider, sessionPayload, date }))
      }

      const fullSummary = summaries.join('\n\n')
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
