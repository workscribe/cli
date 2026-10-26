import { getOrBuildSessions } from '../sessions/detector'
import { log } from '../utils/logger'
import { todayDate, startOfWeek, eachDayOfRange } from '../utils/format'
import { buildDayPayload, locationContextFrom, type LocationContext } from './payload'
import { postSummary, type WebhookOptions } from './webhook'
import type { AIProvider, WeekSummaryPayload } from '../ai/types'
import type { WorkscribeConfig } from '../config'

export interface WeeklySummaryOptions extends WebhookOptions {
  /** Accepted for compatibility with 1.x scripts — weekly digests are always rendered fresh now. */
  fresh?: boolean
}

interface RunWeeklySummaryInput {
  options: WeeklySummaryOptions
  config: WorkscribeConfig
  provider: AIProvider
}

function collectWeekDays(weekStart: string, today: string, context: LocationContext): WeekSummaryPayload['days'] {
  return eachDayOfRange(weekStart, today).flatMap((day) => {
    const sessions = getOrBuildSessions(day)
    if (sessions.length === 0) return []
    return [buildDayPayload(day, sessions, context)]
  })
}

async function writeWeeklySummary(provider: AIProvider, payload: WeekSummaryPayload): Promise<string> {
  if (provider.summarizeWeek) return provider.summarizeWeek(payload)
  return provider.summarize({ date: payload.weekEnd, sessions: payload.days.flatMap((day) => day.sessions) })
}

function printSummary(summary: string): void {
  log.plain('')
  log.plain(summary)
  log.plain('')
}

/** Shared flow for `summary --week` and `week`: collect Mon–today, render the digest, post it. */
export async function runWeeklySummary({ options, config, provider }: RunWeeklySummaryInput): Promise<void> {
  const today = todayDate()
  const weekStart = startOfWeek(today)
  const days = collectWeekDays(weekStart, today, locationContextFrom(config))
  if (days.length === 0) {
    log.plain('No activity captured this week.')
    return
  }

  const summary = await writeWeeklySummary(provider, { weekStart, weekEnd: today, days })
  printSummary(summary)
  await postSummary({ options, config, summary })
}
