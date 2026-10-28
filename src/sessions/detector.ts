import type { EventRow, SessionRow } from '../db/types'
import {
  insertSession,
  insertSessionEvent,
  clearSessionsForDate,
  getSessionsForDate,
  getEventsForDate,
  getEventsBySessionId,
  countEventsBetween,
  sumSessionEventCounts,
  runInImmediateTransaction,
} from '../db'
import { readConfig } from '../config'
import { localDayBounds } from '../utils/format'
import { splitByIdleGap, splitByRepo, minutesBetween, REPO_SWITCH_GAP_MS } from './grouper'

export interface Session {
  id: number
  date: string
  startedAt: string
  endedAt: string
  repoName: string | null
  durationMinutes: number
  eventCount: number
  summary: string | null
  events: EventRow[]
}

export interface GroupingOptions {
  /** Wait at most this long for another process's write lock (default: the connection's 5 s). */
  lockWaitMs?: number
}

/** The day's sessions hold exactly its events — two counts on indexed columns, no event rows loaded. */
function isDayGrouped(date: string): boolean {
  const { start, end } = localDayBounds(date)
  return countEventsBetween(start, end) === sumSessionEventCounts(date)
}

/** Clears the day's sessions and groups its events again, keeping summaries stored on matching sessions. */
function regroupDay(date: string): void {
  // Keyed by repo + start time, so a rebuilt session with the same boundaries gets its summary back
  const savedSummaries = new Map<string, string>()
  for (const sessionRow of getSessionsForDate(date)) {
    if (sessionRow.summary) savedSummaries.set(`${sessionRow.repo_name}|${sessionRow.started_at}`, sessionRow.summary)
  }
  clearSessionsForDate(date)
  buildSessions(date, getEventsForDate(date), savedSummaries)
}

/**
 * Groups the day's events into sessions, unless that's already up to date. The rebuild holds the database's write
 * lock and rechecks first, so processes grouping the same day at once (two editor windows, a save during
 * `summary`) can't interleave and duplicate its sessions. Throws a locked error (`isDatabaseLocked`) if another
 * process keeps the lock past `lockWaitMs`.
 */
export function ensureDayGrouped(date: string, options: GroupingOptions = {}): void {
  if (isDayGrouped(date)) return
  runInImmediateTransaction(
    () => {
      // Another process may have regrouped the day while this one waited for the lock
      if (isDayGrouped(date)) return
      regroupDay(date)
    },
    { busyTimeoutMs: options.lockWaitMs }
  )
}

function toSession(sessionRow: SessionRow): Session {
  return {
    id: sessionRow.id,
    date: sessionRow.date,
    startedAt: sessionRow.started_at,
    endedAt: sessionRow.ended_at,
    repoName: sessionRow.repo_name,
    durationMinutes: minutesBetween(sessionRow.started_at, sessionRow.ended_at),
    eventCount: sessionRow.event_count,
    summary: sessionRow.summary,
    events: getEventsBySessionId(sessionRow.id),
  }
}

export function getOrBuildSessions(date: string): Session[] {
  ensureDayGrouped(date)
  return getSessionsForDate(date).map(toSession)
}

function buildSessions(date: string, events: EventRow[], savedSummaries: Map<string, string>): void {
  const config = readConfig()
  const idleMs = config.session.idleTimeout * 60 * 1000

  const timeGroups = splitByIdleGap(events, idleMs)

  for (const group of timeGroups) {
    if (group.length === 0) continue

    const repoGroups = splitByRepo(group, REPO_SWITCH_GAP_MS)

    for (const repoGroup of repoGroups) {
      if (repoGroup.length === 0) continue

      const first = repoGroup[0]
      const last = repoGroup[repoGroup.length - 1]
      const repoName = last.repo_name ?? first.repo_name ?? null

      // Restore a previously generated summary if the session boundaries match
      const summary = savedSummaries.get(`${repoName}|${first.captured_at}`) ?? null

      const sessionId = insertSession({
        date,
        started_at: first.captured_at,
        ended_at: last.captured_at,
        repo_name: repoName,
        event_count: repoGroup.length,
        summary,
      })

      for (const event of repoGroup) {
        insertSessionEvent(sessionId, event.id)
      }
    }
  }
}
