import { Command } from 'commander'
import chalk from 'chalk'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getOrBuildSessions } from '../sessions/detector'
import { getProvider } from '../ai/router'
import { readConfig } from '../config'
import { updateSessionSummary } from '../db'
import { log, debugLog } from '../utils/logger'
import {
  todayDate,
  parseDate,
  formatDate,
  formatDuration,
  startOfWeek,
  eachDayOfRange,
  isoWeekKey,
} from '../utils/format'
import { postToWebhook } from '../integrations/webhook'
import { formatForSlack, isSlackWebhookUrl } from '../integrations/slack'
import { WEEKLY_CACHE_DIR } from '../utils/paths'
import type { DaySummaryPayload, SessionPayload, EventPayload, WeekSummaryPayload } from '../ai/types'
import type { EventRow } from '../db'
import { buildExcludedSet, countExcludedEvents } from '../ai/prompt'

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

function eventRowToPayload(row: EventRow): EventPayload {
  let metadata: Record<string, unknown> = {}
  try {
    if (row.metadata) metadata = JSON.parse(row.metadata)
  } catch {
    /* ignore */
  }
  const payload: EventPayload = {
    category: row.category,
    metadata,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
  }
  if (row.category === 'other' && typeof metadata.hint === 'string') {
    payload.hint = metadata.hint
    const { hint: _hint, tool: _tool, ...rest } = metadata
    payload.metadata = rest
  }
  return payload
}

function sessionToPayload(s: ReturnType<typeof getOrBuildSessions>[number], date: string): SessionPayload {
  return {
    date,
    project: s.repoName,
    branch: s.events[0]?.branch ?? null,
    startTime: formatDate(s.startedAt),
    endTime: formatDate(s.endedAt),
    durationMinutes: s.durationMinutes,
    events: s.events.map(eventRowToPayload),
  }
}

async function handleWebhook(
  opts: { slack?: boolean; webhook?: string },
  config: ReturnType<typeof readConfig>,
  summary: string
): Promise<void> {
  const webhookUrl = opts.webhook ?? (opts.slack ? config.integrations?.slackWebhook : undefined)

  if (webhookUrl) {
    try {
      log.info('Posting to webhook…')
      const username = os.userInfo().username
      const body = isSlackWebhookUrl(webhookUrl) ? formatForSlack(summary, username) : summary
      await postToWebhook(webhookUrl, body)
      log.success('Posted.')
    } catch (error) {
      log.error(`Webhook failed: ${(error as Error).message}`)
    }
  } else if (opts.slack && !config.integrations?.slackWebhook) {
    log.warn('--slack requires integrations.slackWebhook to be set in config')
  }
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
    .action(async (opts) => {
      const config = readConfig()
      let provider
      try {
        provider = getProvider(config)
      } catch (error) {
        log.error((error as Error).message)
        process.exit(1)
      }

      // ── Weekly branch ────────────────────────────────────────────────────────
      if (opts.week) {
        const today = todayDate()
        const weekStart = startOfWeek(today)
        const days = eachDayOfRange(weekStart, today)

        const weeklyDays: WeekSummaryPayload['days'] = []
        for (const day of days) {
          const sessions = getOrBuildSessions(day)
          if (sessions.length > 0) {
            weeklyDays.push({ date: day, sessions: sessions.map((session) => sessionToPayload(session, day)) })
          }
        }

        if (weeklyDays.length === 0) {
          log.plain('No activity captured this week.')
          return
        }

        const cacheKey = isoWeekKey(today)
        const cacheFile = path.join(WEEKLY_CACHE_DIR, `${cacheKey}.md`)

        if (!opts.fresh && fs.existsSync(cacheFile)) {
          const cached = fs.readFileSync(cacheFile, 'utf-8')
          log.plain('')
          log.plain(cached)
          log.plain('')
          log.plain(chalk.dim('  (cached — use --fresh to regenerate)'))
          await handleWebhook(opts, config, cached)
          return
        }

        const payload: WeekSummaryPayload = { weekStart, weekEnd: today, days: weeklyDays }

        log.plain('')
        log.info(`Generating weekly summary via ${chalk.cyan(config.ai.provider)}…`)

        let summary: string
        try {
          summary = provider.summarizeWeek
            ? await provider.summarizeWeek(payload)
            : await provider.summarize({ date: today, sessions: weeklyDays.flatMap((day) => day.sessions) })
        } catch (error) {
          log.error(`Weekly summary failed [${config.ai.provider}]: ${(error as Error).message}`)
          process.exit(1)
        }

        log.plain('')
        log.plain(summary)
        log.plain('')

        // Caching is a best-effort optimisation, not the point of the command —
        // the summary above already succeeded and was shown, so a disk issue
        // here must not report the whole command as failed.
        try {
          fs.mkdirSync(WEEKLY_CACHE_DIR, { recursive: true })
          fs.writeFileSync(cacheFile, summary, { encoding: 'utf-8', mode: 0o600 })
        } catch (error) {
          debugLog('weekly-summary-cache', error)
        }

        await handleWebhook(opts, config, summary)
        return
      }

      // ── Daily branch ─────────────────────────────────────────────────────────
      let date = todayDate()
      if (opts.date) {
        try {
          date = parseDate(opts.date)
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

      if (!opts.fresh) {
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
          await handleWebhook(opts, config, fullSummary)
          return
        }
      }

      const excluded = buildExcludedSet(config.summary?.includeCategories ?? [])
      const allSessionPayloads = sessions.map((session) => sessionToPayload(session, date))

      if (opts.verbose) {
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

      await handleWebhook(opts, config, fullSummary)
    })
}
