import os from 'os'
import path from 'path'
import { formatDate } from '../utils/format'
import type { DaySummaryPayload, EventPayload, SessionPayload } from '../ai/types'
import type { EventRow } from '../db/types'
import type { Session } from '../sessions/detector'
import type { WorkscribeConfig } from '../config'

/** What sessionLocation needs to name a session that isn't in a git repo. */
export interface LocationContext {
  projects: Record<string, string>
  homeDir: string
}

export function locationContextFrom(config: Pick<WorkscribeConfig, 'projects'>): LocationContext {
  return { projects: config.projects ?? {}, homeDir: os.homedir() }
}

const DEFAULT_LOCATION_CONTEXT: LocationContext = { projects: {}, homeDir: os.homedir() }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Metadata is best-effort context for the summary — a corrupt or non-object row must not fail it
function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function eventRowToPayload(row: EventRow): EventPayload {
  const metadata = parseMetadata(row.metadata)
  const payload: EventPayload = {
    category: row.category,
    metadata,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
  }
  if (row.category !== 'other' || typeof metadata.hint !== 'string') return payload

  // Unclassified commands carry their raw hint separately so the prompt can show it on its own
  const { hint, tool: _tool, ...rest } = metadata
  return { ...payload, hint, metadata: rest }
}

function mostFrequentCwdOf(events: EventRow[]): string | null {
  const counts = new Map<string, number>()
  for (const event of events) counts.set(event.cwd, (counts.get(event.cwd) ?? 0) + 1)
  let best: string | null = null
  for (const [cwd, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = cwd
  }
  return best
}

/** The directory most of a session's events ran in, or null for a session with no events. */
export function mostFrequentCwd(session: Session): string | null {
  return mostFrequentCwdOf(session.events)
}

/**
 * A directory inside the session's repo, for git lookups. Agents often run `cd repo && …` from a
 * parent directory that isn't a repo, so the most-used directory overall can miss the repo entirely.
 */
export function repoCwd(session: Session): string | null {
  if (!session.repoName) return mostFrequentCwd(session)
  return mostFrequentCwdOf(session.events.filter((event) => event.repo_name === session.repoName))
}

function homeRelative(directory: string, homeDir: string): string {
  if (directory === homeDir) return '~'
  if (directory.startsWith(homeDir + path.sep)) return `~${directory.slice(homeDir.length)}`
  return directory
}

/**
 * The name a session is shown under: its repo, or — for work outside any git repo — the directory
 * most of its commands ran in (a config.projects name if one is set, else the home-relative path),
 * so the user can always tell where the work happened.
 */
export function sessionLocation(session: Session, context: LocationContext = DEFAULT_LOCATION_CONTEXT): string | null {
  if (session.repoName) return session.repoName
  const cwd = mostFrequentCwd(session)
  if (!cwd) return null
  return context.projects[cwd] ?? homeRelative(cwd, context.homeDir)
}

export function sessionToPayload(
  session: Session,
  date: string,
  context: LocationContext = DEFAULT_LOCATION_CONTEXT
): SessionPayload {
  return {
    date,
    project: sessionLocation(session, context),
    branch: session.events[0]?.branch ?? null,
    startTime: formatDate(session.startedAt),
    endTime: formatDate(session.endedAt),
    durationMinutes: session.durationMinutes,
    events: session.events.map(eventRowToPayload),
  }
}

export function buildDayPayload(
  date: string,
  sessions: Session[],
  context: LocationContext = DEFAULT_LOCATION_CONTEXT
): DaySummaryPayload {
  return { date, sessions: sessions.map((session) => sessionToPayload(session, date, context)) }
}
