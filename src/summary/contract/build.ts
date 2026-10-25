import { eventRowToPayload, mostFrequentCwd, sessionLocation } from '../payload'
import { sessionKey } from '../store'
import { SCHEMA_VERSION } from './constants'
import { collectCapturedCommits, collectNotes, contractEvents, mergeCommits } from './utils'
import type { EventRow } from '../../db/types'
import type { Session } from '../../sessions/detector'
import type { EventJson, EventsJson, EventsJsonOptions, SessionJson, SessionJsonOptions, SessionsJson } from './types'

/** Never includes the full command, the event's cwd or an IDE file path. */
export function eventToJson(row: EventRow): EventJson {
  const { category, metadata, hint, exitCode, durationMs } = eventRowToPayload(row)
  return {
    capturedAt: row.captured_at,
    category,
    metadata,
    ...(hint === undefined ? {} : { hint }),
    exitCode,
    durationMs,
    source: row.source,
  }
}

export function sessionToJson(session: Session, { location, git, includeCategories }: SessionJsonOptions): SessionJson {
  return {
    key: sessionKey(session.repoName, session.startedAt),
    project: sessionLocation(session, location),
    repoName: session.repoName,
    repoPath: git.repoPath,
    cwd: mostFrequentCwd(session),
    branch: session.events[0]?.branch ?? null,
    startedAt: session.startedAt,
    endedAt: session.endedAt,
    durationMinutes: session.durationMinutes,
    eventCount: session.eventCount,
    notes: collectNotes(session.events),
    commits: mergeCommits(collectCapturedCommits(session.events), git.commits, git.othersSubjects),
    events: contractEvents(session.events, includeCategories).map(eventToJson),
  }
}

export function buildSessionsJson(date: string, sessions: SessionJson[]): SessionsJson {
  return { schemaVersion: SCHEMA_VERSION, date, sessions }
}

export function buildEventsJson(
  date: string,
  rows: EventRow[],
  { limit, includeCategories }: EventsJsonOptions
): EventsJson {
  const events = contractEvents(rows, includeCategories)
  return { schemaVersion: SCHEMA_VERSION, date, total: events.length, events: events.slice(0, limit).map(eventToJson) }
}
