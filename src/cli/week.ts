import { Command } from 'commander'
import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { getOrBuildSessions } from '../sessions/detector'
import { getProvider } from '../ai/router'
import { readConfig } from '../config'
import { log } from '../utils/logger'
import { todayDate, startOfWeek, eachDayOfRange, isoWeekKey, formatDate } from '../utils/format'
import { postToWebhook } from '../integrations/webhook'
import { formatForSlack, isSlackWebhookUrl } from '../integrations/slack'
import { WEEKLY_CACHE_DIR } from '../utils/paths'
import type { WeekSummaryPayload, SessionPayload, EventPayload } from '../ai/types'
import type { EventRow } from '../db'

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

function sessionToPayload(session: ReturnType<typeof getOrBuildSessions>[number], date: string): SessionPayload {
  return {
    date,
    project: session.repoName,
    branch: session.events[0]?.branch ?? null,
    startTime: formatDate(session.startedAt),
    endTime: formatDate(session.endedAt),
    durationMinutes: session.durationMinutes,
    events: session.events.map(eventRowToPayload),
  }
}

async function postSummary(
  opts: { slack?: boolean; webhook?: string },
  config: ReturnType<typeof readConfig>,
  summary: string
): Promise<void> {
  const webhookUrl = opts.webhook ?? (opts.slack ? config.integrations?.slackWebhook : undefined)
  if (!webhookUrl) {
    if (opts.slack) log.warn('--slack requires integrations.slackWebhook to be set in config')
    return
  }
  try {
    log.info('Posting to webhook…')
    const username = os.userInfo().username
    const body = isSlackWebhookUrl(webhookUrl) ? formatForSlack(summary, username) : summary
    await postToWebhook(webhookUrl, body)
    log.success('Posted.')
  } catch (error) {
    log.error(`Webhook failed: ${(error as Error).message}`)
  }
}

export function registerWeek(program: Command): void {
  program
    .command('week')
    .description('Generate an AI weekly digest (Mon–today)')
    .option('--fresh', 'bypass cache and regenerate')
    .option('--slack', 'post to Slack webhook from config')
    .option('--webhook <url>', 'post to a custom webhook URL')
    .action(async (opts) => {
      const config = readConfig()
      let provider
      try {
        provider = getProvider(config)
      } catch (error) {
        log.error((error as Error).message)
        process.exit(1)
      }

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
        await postSummary(opts, config, cached)
        return
      }

      const payload: WeekSummaryPayload = { weekStart, weekEnd: today, days: weeklyDays }

      log.plain('')
      log.info(`Generating weekly digest via ${chalk.cyan(config.ai.provider)}…`)

      try {
        const summary = provider.summarizeWeek
          ? await provider.summarizeWeek(payload)
          : await provider.summarize({ date: today, sessions: weeklyDays.flatMap((day) => day.sessions) })

        log.plain('')
        log.plain(summary)
        log.plain('')

        fs.mkdirSync(WEEKLY_CACHE_DIR, { recursive: true })
        fs.writeFileSync(cacheFile, summary, { encoding: 'utf-8', mode: 0o600 })

        await postSummary(opts, config, summary)
      } catch (error) {
        log.error(`Weekly digest failed [${config.ai.provider}]: ${(error as Error).message}`)
        process.exit(1)
      }
    })
}
