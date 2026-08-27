import type { EventRow } from '../db/types'
import {
  insertSession,
  insertSessionEvent,
  clearSessionsForDate,
  getSessionsForDate,
  getEventsForDate,
  getEventsBySessionId,
} from '../db'
import { readConfig } from '../config'
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

export function getOrBuildSessions(date: string): Session[] {
  // Check if sessions already exist for this date
  const existing = getSessionsForDate(date)
  const events = getEventsForDate(date)

  if (events.length === 0) return []

  // If sessions exist and event count matches, use cached
  const cachedEventCount = existing.reduce((sum, sessionRow) => sum + sessionRow.event_count, 0)
  if (existing.length > 0 && cachedEventCount === events.length) {
    return existing.map((sessionRow) => ({
      id: sessionRow.id,
      date: sessionRow.date,
      startedAt: sessionRow.started_at,
      endedAt: sessionRow.ended_at,
      repoName: sessionRow.repo_name,
      durationMinutes: minutesBetween(sessionRow.started_at, sessionRow.ended_at),
      eventCount: sessionRow.event_count,
      summary: sessionRow.summary,
      events: getEventsBySessionId(sessionRow.id),
    }))
  }

  // Preserve any cached summaries before clearing — keyed by repo+start time
  // so they can be restored to matching sessions after rebuild
  const savedSummaries = new Map<string, string>()
  for (const s of existing) {
    if (s.summary) savedSummaries.set(`${s.repo_name}|${s.started_at}`, s.summary)
  }

  // Rebuild sessions
  clearSessionsForDate(date)
  return buildSessions(date, events, savedSummaries)
}

function buildSessions(date: string, events: EventRow[], savedSummaries: Map<string, string> = new Map()): Session[] {
  const config = readConfig()
  const idleMs = config.session.idleTimeout * 60 * 1000

  const sessions: Session[] = []
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

      sessions.push({
        id: sessionId,
        date,
        startedAt: first.captured_at,
        endedAt: last.captured_at,
        repoName,
        durationMinutes: minutesBetween(first.captured_at, last.captured_at),
        eventCount: repoGroup.length,
        summary,
        events: repoGroup,
      })
    }
  }

  return sessions
}
