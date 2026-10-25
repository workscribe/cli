import chalk from 'chalk'
import fs from 'fs'
import path from 'path'
import { getOrBuildSessions } from '../sessions/detector'
import { log, debugLog } from '../utils/logger'
import { todayDate, startOfWeek, eachDayOfRange, isoWeekKey } from '../utils/format'
import { WEEKLY_CACHE_DIR } from '../utils/paths'
import { buildDayPayload, locationContextFrom, type LocationContext } from './payload'
import { resolveEngine, engineLabel } from '../ai/engine'
import { isCachedEngine, type CachedEngine } from './store'
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

function collectWeekDays(weekStart: string, today: string, context: LocationContext): WeekSummaryPayload['days'] {
  return eachDayOfRange(weekStart, today).flatMap((day) => {
    const sessions = getOrBuildSessions(day)
    if (sessions.length === 0) return []
    return [buildDayPayload(day, sessions, context)]
  })
}

function weeklyCacheFile(week: string, engine: CachedEngine): string {
  return path.join(WEEKLY_CACHE_DIR, `${week}.${engine}.md`)
}

/** This engine's cached digest, or a 1.x `<week>.md` digest (written by a provider or Ollama). */
function findWeeklyCache(week: string, engine: CachedEngine): string | null {
  const candidates = [weeklyCacheFile(week, engine), path.join(WEEKLY_CACHE_DIR, `${week}.md`)]
  return candidates.find((file) => fs.existsSync(file)) ?? null
}

async function callProvider(provider: AIProvider, payload: WeekSummaryPayload): Promise<string> {
  if (provider.summarizeWeek) return provider.summarizeWeek(payload)
  return provider.summarize({ date: payload.weekEnd, sessions: payload.days.flatMap((day) => day.sessions) })
}

/** Announces and runs the generation, naming the engine in the error if it fails. */
async function generateWeeklySummary(
  { config, provider, noun }: Omit<RunWeeklySummaryInput, 'options'>,
  payload: WeekSummaryPayload
): Promise<string> {
  const label = engineLabel(config)
  log.plain('')
  log.info(`Generating weekly ${noun} via ${chalk.cyan(label)}…`)
  try {
    return await callProvider(provider, payload)
  } catch (error) {
    throw new Error(`Weekly ${noun} failed [${label}]: ${(error as Error).message}`, { cause: error })
  }
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
  const days = collectWeekDays(weekStart, today, locationContextFrom(config))
  if (days.length === 0) {
    log.plain('No activity captured this week.')
    return
  }

  const engine = resolveEngine(config)
  const week = isoWeekKey(today)
  const cachedFile = !options.fresh && isCachedEngine(engine) ? findWeeklyCache(week, engine) : null
  if (cachedFile) {
    await serveCachedSummary(cachedFile, options, config)
    return
  }

  const summary = await generateWeeklySummary({ config, provider, noun }, { weekStart, weekEnd: today, days })
  printSummary(summary)
  if (isCachedEngine(engine)) writeWeeklyCache(weeklyCacheFile(week, engine), summary, noun)
  await postSummary(options, config, summary)
}
