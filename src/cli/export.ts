import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import { getOrBuildSessions } from '../sessions/detector'
import { getProvider } from '../ai/router'
import { readConfig } from '../config'
import { log } from '../utils/logger'
import { todayDate, parseDate, formatDate } from '../utils/format'
import { EXPORTS_DIR } from '../utils/paths'
import type { DaySummaryPayload, SessionPayload, EventPayload } from '../ai/types'
import type { EventRow } from '../db'

function eventRowToPayload(row: EventRow): EventPayload {
  let metadata: Record<string, unknown> = {}
  try {
    if (row.metadata) metadata = JSON.parse(row.metadata)
  } catch {
    /* ignore */
  }
  return { category: row.category, metadata, exitCode: row.exit_code, durationMs: row.duration_ms }
}

export function registerExport(program: Command): void {
  program
    .command('export')
    .description('Export work summary as a markdown file')
    .option('--date <YYYY-MM-DD>', 'date to export (default: today)')
    .option('--output <path>', 'output file path (default: ~/.workscribe/exports/)')
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

      const config = readConfig()
      let provider
      try {
        provider = getProvider(config)
      } catch (e) {
        log.error((e as Error).message)
        process.exit(1)
      }

      const sessionPayloads: SessionPayload[] = sessions.map((session) => ({
        date,
        project: session.repoName,
        branch: session.events[0]?.branch ?? null,
        startTime: formatDate(session.startedAt),
        endTime: formatDate(session.endedAt),
        durationMinutes: session.durationMinutes,
        events: session.events.map(eventRowToPayload),
      }))

      const payload: DaySummaryPayload = { date, sessions: sessionPayloads }

      log.info(`Generating summary via ${config.ai.provider}…`)
      const summary = await provider.summarize(payload)

      const outputPath = opts.output ?? path.join(EXPORTS_DIR, `workscribe-${date}.md`)

      if (!fs.existsSync(EXPORTS_DIR)) fs.mkdirSync(EXPORTS_DIR, { recursive: true, mode: 0o700 })

      fs.writeFileSync(outputPath, `# Work Summary — ${date}\n\n${summary}\n`, { encoding: 'utf-8', mode: 0o600 })
      log.success(`Saved: ${outputPath}`)
    })
}
