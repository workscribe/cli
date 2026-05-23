import { Command } from 'commander'
import chalk from 'chalk'
import { getOrBuildSessions } from '../sessions/detector'
import { getProvider } from '../ai/router'
import { readConfig } from '../config'
import { updateSessionSummary } from '../db'
import { log } from '../utils/logger'
import { todayDate, parseDate, formatDate } from '../utils/format'
import type { DaySummaryPayload, SessionPayload, EventPayload } from '../ai/types'
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

export function registerSummary(program: Command): void {
  program
    .command('summary')
    .description('Generate an AI work summary')
    .option('--date <YYYY-MM-DD>', 'date to summarize (default: today)')
    .option('--week', 'summarize the current week')
    .option('--fresh', 'bypass cache and regenerate')
    .action(async (opts) => {
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

      // Check cache (unless --fresh)
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

      // Build payload
      const config = readConfig()
      let provider
      try {
        provider = getProvider(config)
      } catch (e) {
        log.error((e as Error).message)
        process.exit(1)
      }

      const sessionPayloads: SessionPayload[] = sessions.map((s) => ({
        date,
        project: s.repoName,
        branch: s.events[0]?.branch ?? null,
        startTime: formatDate(s.startedAt),
        endTime: formatDate(s.endedAt),
        durationMinutes: s.durationMinutes,
        events: s.events.map(eventRowToPayload),
      }))

      const payload: DaySummaryPayload = { date, sessions: sessionPayloads }

      log.plain('')
      log.info(`Generating summary via ${chalk.cyan(config.ai.provider)}…`)

      try {
        const summary = await provider.summarize(payload)
        log.plain('')
        log.plain(summary)
        log.plain('')

        // Cache per session (store full summary on first session for simplicity)
        if (sessions[0]) {
          updateSessionSummary(sessions[0].id, summary)
        }
      } catch (e) {
        log.error(`Summary failed [${config.ai.provider}]: ${(e as Error).message}`)
        process.exit(1)
      }
    })
}
