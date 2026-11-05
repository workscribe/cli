import { log } from '../utils/logger'
import { todayDate, startOfWeek, eachDayOfRange } from '../utils/format'
import { locationContextFrom, threadRepoCwd, threadToPayload, type LocationContext } from './payload'
import { postSummary, type WebhookOptions } from './webhook'
import { DAY_GIT_BUDGET_MS, lookupDayCommits } from './day-commits'
import { keepsStdoutClean, type SummaryFormat } from './output-format'
import { toPlainText } from './plain-text'
import { weekLayoutOf } from '../ai/engines/template/week'
import type { AIProvider, WeekLayout, WeekSummaryPayload } from '../ai/types'
import type { WorkscribeConfig } from '../config'
import type { DayBlock, DayThread } from '../db/day-threads'

/** All of the week's git lookups together get at most the day's budget: one `git log` per repo covers the week. */
export const WEEK_GIT_BUDGET_MS = DAY_GIT_BUDGET_MS

export interface WeeklySummaryOptions extends WebhookOptions {
  /** Accepted for compatibility with 1.x scripts — weekly digests are always rendered fresh now. */
  fresh?: boolean
  /** Each project then each branch (the default), or day by day */
  by?: WeekLayout
  /** `--format`; `summary.format` decides without it */
  format?: SummaryFormat
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

interface ThreadOfWeek {
  date: string
  thread: DayThread
  block: DayBlock
}

/** git's commits for every thread of the week: one `git log` per repo over the week, within one budget. */
function weekCommits(threads: ThreadOfWeek[]): ReturnType<typeof lookupDayCommits> {
  const windows = threads.map(({ thread }) => ({
    cwd: threadRepoCwd(thread.events),
    startedAt: thread.startedAt,
    endedAt: thread.endedAt,
  }))
  return lookupDayCommits(windows, { budgetMs: WEEK_GIT_BUDGET_MS })
}

function collectWeekDays(
  { weekStart, today }: WeekRange,
  loadDay: RunWeeklySummaryInput['loadDay'],
  context: LocationContext
): WeekSummaryPayload['days'] {
  const threads = eachDayOfRange(weekStart, today).flatMap((date) =>
    loadDay(date).flatMap((block) => block.threads.map((thread) => ({ date, thread, block })))
  )
  const commits = weekCommits(threads)
  const days = new Map<string, WeekSummaryPayload['days'][number]>()
  for (const [index, { date, thread, block }] of threads.entries()) {
    const day = days.get(date) ?? { date, sessions: [] }
    day.sessions.push(threadToPayload(thread, block, { context, gitCommits: commits[index] }))
    days.set(date, day)
  }
  return [...days.values()]
}

/** The week as one JSON document (`summary.format=json`): projects → branches, or days → bullets. */
function weekJson(payload: WeekSummaryPayload, includeCategories: string[]): string {
  const { weekStart, weekEnd } = payload
  return JSON.stringify({ weekStart, weekEnd, ...weekLayoutOf(payload, includeCategories) }, null, 2)
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

/** Shared flow for `summary --week` and `week`: collect Mon–today's threads, render the week, post it. */
export async function runWeeklySummary({ options, config, provider, loadDay }: RunWeeklySummaryInput): Promise<void> {
  const today = todayDate()
  const weekStart = startOfWeek(today)
  const days = collectWeekDays({ weekStart, today }, loadDay, locationContextFrom(config))
  if (days.length === 0) {
    log.plain('No activity captured this week.')
    return
  }

  const payload: WeekSummaryPayload = { weekStart, weekEnd: today, by: options.by ?? 'project', days }
  const summary = await writeWeeklySummary(provider, payload)
  const format = options.format ?? config.summary?.format
  // Only the JSON or the plain text on stdout, so it can be piped; posting still sends the markdown, its status on stderr
  if (format === 'json') log.plain(weekJson(payload, config.summary?.includeCategories ?? []))
  else if (format === 'text') log.plain(toPlainText(summary))
  else printSummary(summary)
  await postSummary({ options, config, summary, statusToStderr: keepsStdoutClean(format) })
}
