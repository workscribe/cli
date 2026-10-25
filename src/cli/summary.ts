import { Command } from 'commander'
import chalk from 'chalk'
import { getOrBuildSessions } from '../sessions/detector'
import { getProvider } from '../ai/router'
import { readConfig } from '../config'
import { updateSessionSummary } from '../db'
import { log } from '../utils/logger'
import { todayDate, parseDate, formatDuration } from '../utils/format'
import type { DaySummaryPayload } from '../ai/types'
import { buildExcludedSet, countExcludedEvents } from '../ai/prompt'
import { sessionToPayload } from '../summary/payload'
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

      const jsonMode = config.summary?.format === 'json'

      if (!options.fresh) {
        const allCached = sessions.every((session) => session.summary)
        if (allCached) {
          const fullSummary = sessions.map((session) => session.summary!).join('\n\n')
          log.plain('')
          if (jsonMode) {
            const jsonOut: SessionSummaryJson[] = sessions.map((session) => ({
              project: session.repoName,
              branch: session.events[0]?.branch ?? null,
              durationMinutes: session.durationMinutes,
              bullets: parseBullets(session.summary!.replace(/^## .+\n/, '')),
            }))
            log.plain(JSON.stringify({ date, sessions: jsonOut }, null, 2))
          } else {
            log.plain(fullSummary)
          }
          log.plain('')
          log.plain(chalk.dim('  (cached — use --fresh to regenerate)'))
          await postSummary(options, config, fullSummary)
          return
        }
      }

      const excluded = buildExcludedSet(config.summary?.includeCategories ?? [])
      const allSessionPayloads = sessions.map((session) => sessionToPayload(session, date))

      if (options.verbose) {
        log.plain('')
        log.plain(chalk.bold('  Captured events (--verbose):'))
        for (const sessionPayload of allSessionPayloads) {
          const branch = sessionPayload.branch ? ` (${sessionPayload.branch})` : ''
          log.plain(
            chalk.dim(
              `\n  ${sessionPayload.project ?? 'unknown'}${branch} — ${formatDuration(sessionPayload.durationMinutes)}`
            )
          )
          for (const event of sessionPayload.events) {
            const tag = excluded.has(event.category)
              ? chalk.dim(`  [excluded] ${event.category}`)
              : `  ${event.category}`
            const hint = event.hint ? chalk.dim(` [${event.hint}]`) : ''
            const meta = Object.keys(event.metadata).length > 0 ? chalk.dim(` ${JSON.stringify(event.metadata)}`) : ''
            log.plain(`    ${tag}${hint}${meta}`)
          }
        }
        log.plain('')
      }

      log.plain('')
      log.info(`Generating summary via ${chalk.cyan(config.ai.provider)}…`)

      const allSummaries: string[] = []
      const jsonSessions: SessionSummaryJson[] = []

      for (let index = 0; index < sessions.length; index++) {
        const session = sessions[index]
        const sessionPayload: DaySummaryPayload = { date, sessions: [allSessionPayloads[index]] }
        try {
          const bullets = await provider.summarize(sessionPayload)
          const project = session.repoName ?? 'unknown'
          const branch = session.events[0]?.branch ? ` (${session.events[0].branch})` : ''
          const duration = formatDuration(session.durationMinutes)
          const heading = `## ${project}${branch} — ${duration}`
          const summary = `${heading}\n${bullets.trim()}`
          allSummaries.push(summary)
          updateSessionSummary(session.id, summary)
          if (jsonMode) {
            jsonSessions.push({
              project: session.repoName,
              branch: session.events[0]?.branch ?? null,
              durationMinutes: session.durationMinutes,
              bullets: parseBullets(bullets),
            })
          }
        } catch (error) {
          log.error(`Summary failed [${config.ai.provider}]: ${(error as Error).message}`)
          process.exit(1)
        }
      }

      const fullSummary = allSummaries.join('\n\n')
      log.plain('')
      if (jsonMode) {
        log.plain(JSON.stringify({ date, sessions: jsonSessions }, null, 2))
      } else {
        log.plain(fullSummary)
      }
      log.plain('')

      const excludedCounts = countExcludedEvents(allSessionPayloads, excluded)
      if (excludedCounts.size > 0) {
        const total = [...excludedCounts.values()].reduce((sum, count) => sum + count, 0)
        const breakdown = [...excludedCounts.entries()].map(([category, count]) => `${category} ×${count}`).join(', ')
        log.plain(chalk.dim(`  ℹ ${total} event${total === 1 ? '' : 's'} not included in summary (${breakdown})`))
        log.plain(chalk.dim('    Use --verbose to inspect · workscribe config set summary.includeCategories to opt in'))
        log.plain('')
      }

      await postSummary(options, config, fullSummary)
    })
}
