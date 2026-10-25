import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import { getOrBuildSessions } from '../sessions/detector'
import { log, debugLog } from '../utils/logger'
import { todayDate, startOfWeek, eachDayOfRange, isoWeekKey } from '../utils/format'
import { WEEKLY_CACHE_DIR } from '../utils/paths'
import { buildDayPayload } from './payload'
import { postSummary, type WebhookOptions } from './webhook'
import type { AIProvider, WeekSummaryPayload } from '../ai/types'
import type { WorkscribeConfig } from '../config'

export interface WeeklySummaryOptions extends WebhookOptions {
  fresh?: boolean
}

interface RunWeeklySummaryInput {
  options: WeeklySummaryOptions
  config: WorkscribeConfig
  provider: AIProvider
  /** What the command calls its output — "summary" for `summary --week`, "digest" for `week`. */
  noun: 'summary' | 'digest'
}

function collectWeekDays(weekStart: string, today: string): WeekSummaryPayload['days'] {
  return eachDayOfRange(weekStart, today).flatMap((day) => {
    const sessions = getOrBuildSessions(day)
    if (sessions.length === 0) return []
    return [buildDayPayload(day, sessions)]
  })
}

async function generateWeeklySummary(provider: AIProvider, payload: WeekSummaryPayload): Promise<string> {
  if (provider.summarizeWeek) return provider.summarizeWeek(payload)
  return provider.summarize({ date: payload.weekEnd, sessions: payload.days.flatMap((day) => day.sessions) })
}

// Caching is a best-effort optimisation, not the point of the command — the summary
// was already generated and shown, so a disk issue here must not fail the command.
function writeWeeklyCache(cacheFile: string, summary: string, noun: RunWeeklySummaryInput['noun']): void {
  try {
    fs.mkdirSync(WEEKLY_CACHE_DIR, { recursive: true })
    fs.writeFileSync(cacheFile, summary, { encoding: 'utf-8', mode: 0o600 })
  } catch (error) {
    debugLog(`weekly-${noun}-cache`, error)
  }
}

function printSummary(summary: string): void {
  log.plain('')
  log.plain(summary)
  log.plain('')
}

async function serveCachedSummary(cacheFile: string, options: WebhookOptions, config: WorkscribeConfig): Promise<void> {
  const cached = fs.readFileSync(cacheFile, 'utf-8')
  printSummary(cached)
  log.plain(chalk.dim('  (cached — use --fresh to regenerate)'))
  await postSummary(options, config, cached)
}

/**
 * Shared flow for `summary --week` and `week`: collect Mon–today, serve or regenerate the cache, post.
 * Throws when the provider fails; the calling command decides how to exit.
 */
export async function runWeeklySummary({ options, config, provider, noun }: RunWeeklySummaryInput): Promise<void> {
  const today = todayDate()
  const weekStart = startOfWeek(today)
  const days = collectWeekDays(weekStart, today)
  if (days.length === 0) {
    log.plain('No activity captured this week.')
    return
  }

  const cacheFile = path.join(WEEKLY_CACHE_DIR, `${isoWeekKey(today)}.md`)
  if (!options.fresh && fs.existsSync(cacheFile)) {
    await serveCachedSummary(cacheFile, options, config)
    return
  }

  log.plain('')
  log.info(`Generating weekly ${noun} via ${chalk.cyan(config.ai.provider)}…`)

  let summary: string
  try {
    summary = await generateWeeklySummary(provider, { weekStart, weekEnd: today, days })
  } catch (error) {
    throw new Error(`Weekly ${noun} failed [${config.ai.provider}]: ${(error as Error).message}`, { cause: error })
  }

  printSummary(summary)
  writeWeeklyCache(cacheFile, summary, noun)
  await postSummary(options, config, summary)
}
