import { log } from '../utils/logger'
import { todayDate, startOfWeek, eachDayOfRange } from '../utils/format'
import { locationContextFrom, threadToPayload, type LocationContext } from './payload'
import { postSummary, type WebhookOptions } from './webhook'
import type { AIProvider, WeekSummaryPayload } from '../ai/types'
import type { WorkscribeConfig } from '../config'
import type { DayBlock } from '../db/day-threads'

export interface WeeklySummaryOptions extends WebhookOptions {
  /** Accepted for compatibility with 1.x scripts — weekly digests are always rendered fresh now. */
  fresh?: boolean
}

interface RunWeeklySummaryInput {
  options: WeeklySummaryOptions
  config: WorkscribeConfig
  provider: AIProvider
  /** A day's blocks and threads — `loadDayThreads`, after the caller checked the data is upgraded */
  loadDay: (date: string) => DayBlock[]
}

interface WeekRange {
  weekStart: string
  today: string
}

function collectWeekDays(
  { weekStart, today }: WeekRange,
  loadDay: RunWeeklySummaryInput['loadDay'],
  context: LocationContext
): WeekSummaryPayload['days'] {
  return eachDayOfRange(weekStart, today).flatMap((date) => {
    const sessions = loadDay(date).flatMap((block) =>
      block.threads.map((thread) => threadToPayload(thread, block, { context }))
    )
    return sessions.length === 0 ? [] : [{ date, sessions }]
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

/** Shared flow for `summary --week` and `week`: collect Mon–today's threads, render the digest, post it. */
export async function runWeeklySummary({ options, config, provider, loadDay }: RunWeeklySummaryInput): Promise<void> {
  const today = todayDate()
  const weekStart = startOfWeek(today)
  const days = collectWeekDays({ weekStart, today }, loadDay, locationContextFrom(config))
  if (days.length === 0) {
    log.plain('No activity captured this week.')
    return
  }

  const summary = await writeWeeklySummary(provider, { weekStart, weekEnd: today, days })
  printSummary(summary)
  await postSummary({ options, config, summary })
}
