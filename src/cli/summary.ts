import { Command } from 'commander'
import chalk from 'chalk'
import { getOrBuildSessions } from '../sessions/detector'
import { getProvider } from '../ai/router'
import { readConfig } from '../config'
import { getSessionSummaries, saveSessionSummary } from '../db'
import { log } from '../utils/logger'
import { todayDate, parseDate } from '../utils/format'
import type { AIProvider, DaySummaryPayload, SessionPayload } from '../ai/types'
import { resolveEngine, engineLabel } from '../ai/engine'
import { countExcludedEvents } from '../ai/prompt'
import { buildExcludedSet } from '../summary/exclusions'
import { sessionToPayload, locationContextFrom } from '../summary/payload'
import { formatSessionHeading, formatSessionLabel } from '../summary/heading'
import { sessionKey, pickSavedSummary, isCachedEngine, type SavedSummary } from '../summary/store'
import { postSummary } from '../summary/webhook'
import { runWeeklySummary } from '../summary/weekly'

interface SessionSummaryJson {
  project: string | null
  branch: string | null
  durationMinutes: number
  bullets: string[]
}

/** Parse AI bullet output into a clean string array. Handles both - and • prefixes. */
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
  label: string
}): Promise<string> {
  const daySummaryPayload: DaySummaryPayload = { date: input.date, sessions: [input.sessionPayload] }
  try {
    const bullets = (await input.provider.summarize(daySummaryPayload)).trim()
    return `${formatSessionHeading(input.sessionPayload)}\n${bullets}`
  } catch (error) {
    log.error(`Summary failed [${input.label}]: ${(error as Error).message}`)
    process.exit(1)
  }
}

/** Says which sessions came from saved summaries, so it's clear why --fresh would change the output. */
function printSavedNote(saved: (SavedSummary | null)[]): void {
  const fromSkill = saved.filter((entry) => entry?.fromSkill).length
  const cached = saved.filter((entry) => entry && !entry.fromSkill).length
  const parts = [
    fromSkill > 0 ? `${fromSkill} written by the Workscribe agent skill` : null,
    cached > 0 ? `${cached} cached` : null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return
  log.plain(chalk.dim(`  (${parts.join(', ')} — use --fresh to regenerate)`))
}

export function registerSummary(program: Command): void {
  program
    .command('summary')
    .description('Generate an AI work summary')
    .option('--date <YYYY-MM-DD>', 'date to summarize (default: today)')
    .option('--week', 'summarize the current week')
    .option('--fresh', 'bypass cache and regenerate')
    .option('--verbose', 'show all captured events including those not sent to AI')
    .option('--slack', 'post summary to Slack webhook from config')
    .option('--webhook <url>', 'post summary to a custom webhook URL')
    .action(async (options) => {
      const config = readConfig()
      let provider
      try {
        provider = getProvider(config)
      } catch (error) {
        log.error((error as Error).message)
        process.exit(1)
      }

      // ── Weekly branch ────────────────────────────────────────────────────────
      if (options.week) {
        try {
          await runWeeklySummary({ options, config, provider, noun: 'summary' })
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

      const engine = resolveEngine(config)
      const label = engineLabel(config)
      const sessionPayloads = sessions.map((session) => sessionToPayload(session, date, locationContextFrom(config)))
      const keys = sessions.map((session) => sessionKey(session.repoName, session.startedAt))
      const jsonMode = config.summary?.format === 'json'

      // A summary the agent skill saved, or this engine's cache — `--fresh` ignores both
      const saved = keys.map((key) => (options.fresh ? null : pickSavedSummary(getSessionSummaries(key), engine)))
      const needsGeneration = saved.some((entry) => entry === null)
      const excluded = buildExcludedSet(config.summary?.includeCategories ?? [])
      if (needsGeneration) {
        if (options.verbose) printCapturedEvents(sessionPayloads, excluded)
        log.plain('')
        log.info(`Generating summary via ${chalk.cyan(label)}…`)
      }

      const summaries: string[] = []
      for (const [index, sessionPayload] of sessionPayloads.entries()) {
        const savedSummary = saved[index]
        if (savedSummary) {
          summaries.push(savedSummary.text)
          continue
        }
        const generated = await generateSessionSummary({ provider, sessionPayload, date, label })
        if (isCachedEngine(engine)) saveSessionSummary(keys[index], engine, generated)
        summaries.push(generated)
      }

      const fullSummary = summaries.join('\n\n')
      log.plain('')
      log.plain(jsonMode ? toJsonOutput(date, sessionPayloads, summaries.map(stripHeading)) : fullSummary)
      log.plain('')
      printSavedNote(saved)
      if (needsGeneration) printExcludedFooter(sessionPayloads, excluded)

      await postSummary(options, config, fullSummary)
    })
}
