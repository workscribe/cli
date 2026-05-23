import type { EventRow } from '../db/types'
import {
  insertSession,
  insertSessionEvent,
  clearSessionsForDate,
  getSessionsForDate,
  getEventsForDate,
} from '../db'
import { readConfig } from '../config'
import { splitByIdleGap, splitByRepo, minutesBetween } from './grouper'

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
  const cachedEventCount = existing.reduce((sum, s) => sum + s.event_count, 0)
  if (existing.length > 0 && cachedEventCount === events.length) {
    return existing.map((s) => ({
      id: s.id,
      date: s.date,
      startedAt: s.started_at,
      endedAt: s.ended_at,
      repoName: s.repo_name,
      durationMinutes: minutesBetween(s.started_at, s.ended_at),
      eventCount: s.event_count,
      summary: s.summary,
      events: [], // not needed when using cached
    }))
  }

  // Rebuild sessions
  clearSessionsForDate(date)
  return buildSessions(date, events)
}

function buildSessions(date: string, events: EventRow[]): Session[] {
  const config = readConfig()
  const idleMs = config.session.idleTimeout * 60 * 1000

  // Group events by repo, then split by idle gap within each repo group
  const sessions: Session[] = []

  // Split by idle gaps first (regardless of repo)
  const timeGroups = splitByIdleGap(events, idleMs)

  for (const group of timeGroups) {
    if (group.length === 0) continue

    // Within each time group, further split by repo change
    const repoGroups = splitByRepo(group)

    for (const repoGroup of repoGroups) {
      if (repoGroup.length === 0) continue

      const first = repoGroup[0]
      const last = repoGroup[repoGroup.length - 1]
      const repoName = last.repo_name ?? first.repo_name ?? null

      const sessionId = insertSession({
        date,
        started_at: first.captured_at,
        ended_at: last.captured_at,
        repo_name: repoName,
        event_count: repoGroup.length,
        summary: null,
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
        summary: null,
        events: repoGroup,
      })
    }
  }

  return sessions
}

