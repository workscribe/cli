import { Command } from 'commander'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import { getOrBuildSessions } from '../sessions/detector'
import { getProvider } from '../ai/router'
import { readConfig } from '../config'
import { updateSessionSummary } from '../db'
import { log } from '../utils/logger'
import { todayDate, parseDate, formatDate, startOfWeek, eachDayOfRange, isoWeekKey } from '../utils/format'
import { postToWebhook } from '../integrations/webhook'
import { WEEKLY_CACHE_DIR } from '../utils/paths'
import type { DaySummaryPayload, SessionPayload, EventPayload, WeekSummaryPayload } from '../ai/types'
import type { EventRow } from '../db'

function eventRowToPayload(row: EventRow): EventPayload {
  let metadata: Record<string, unknown> = {}
  try {
    if (row.metadata) metadata = JSON.parse(row.metadata)
  } catch { /* ignore */ }
  return {
    category: row.category,
    metadata,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
  }
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
  summary: string,
): Promise<void> {
  const webhookUrl =
    opts.webhook ??
    (opts.slack ? config.integrations?.slackWebhook : undefined)

  if (webhookUrl) {
    try {
      log.info('Posting to webhook…')
      await postToWebhook(webhookUrl, summary)
      log.success('Posted.')
    } catch (e) {
      log.error(`Webhook failed: ${(e as Error).message}`)
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
    .option('--slack', 'post summary to Slack webhook from config')
    .option('--webhook <url>', 'post summary to a custom webhook URL')
    .action(async (opts) => {
      const config = readConfig()
      let provider
      try {
        provider = getProvider(config)
      } catch (e) {
        log.error((e as Error).message)
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
            weeklyDays.push({ date: day, sessions: sessions.map((s) => sessionToPayload(s, day)) })
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

        try {
          const summary = provider.summarizeWeek
            ? await provider.summarizeWeek(payload)
            : await provider.summarize({ date: today, sessions: weeklyDays.flatMap((d) => d.sessions) })

          log.plain('')
          log.plain(summary)
          log.plain('')

          fs.mkdirSync(WEEKLY_CACHE_DIR, { recursive: true })
          fs.writeFileSync(cacheFile, summary, { encoding: 'utf-8', mode: 0o600 })

          await handleWebhook(opts, config, summary)
        } catch (e) {
          log.error(`Weekly summary failed [${config.ai.provider}]: ${(e as Error).message}`)
          process.exit(1)
        }
        return
      }

      // ── Daily branch ─────────────────────────────────────────────────────────
      let date = todayDate()
      if (opts.date) {
        try {
          date = parseDate(opts.date)
        } catch (e) {
          log.error((e as Error).message)
          process.exit(1)
        }
      }

      const sessions = getOrBuildSessions(date)

      if (sessions.length === 0) {
        log.plain(`No activity captured for ${date}`)
        return
      }

      if (!opts.fresh) {
        const allCached = sessions.every((s) => s.summary)
        if (allCached) {
          log.plain('')
          for (const s of sessions) {
            log.plain(s.summary!)
          }
          log.plain('')
          log.plain(chalk.dim('  (cached — use --fresh to regenerate)'))
          return
        }
      }

      const sessionPayloads = sessions.map((s) => sessionToPayload(s, date))
      const payload: DaySummaryPayload = { date, sessions: sessionPayloads }

      log.plain('')
      log.info(`Generating summary via ${chalk.cyan(config.ai.provider)}…`)

      try {
        const summary = await provider.summarize(payload)
        log.plain('')
        log.plain(summary)
        log.plain('')

        if (sessions[0]) {
          updateSessionSummary(sessions[0].id, summary)
        }

        await handleWebhook(opts, config, summary)
      } catch (e) {
        log.error(`Summary failed [${config.ai.provider}]: ${(e as Error).message}`)
        process.exit(1)
      }
    })
}
