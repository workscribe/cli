import { branchesOf, eventRowToPayload, mostFrequentCwd, sessionBranch, sessionLocation } from '../payload'
import { EVENTS_SCHEMA_VERSION, SESSIONS_SCHEMA_VERSION } from './constants'
import { collectNotes, contractEvents } from './utils'
import { collectCapturedCommits, mergeCommits } from '../commits'
import { minutesBetween } from '../../sessions/grouper'
import { toActiveMinutes } from '../../sessions/blocks'
import type { EventRow } from '../../db/types'
import type { DayBlock, DayThread } from '../../db/day-threads'
import type {
  BlockJson,
  EventJson,
  EventsJson,
  EventsJsonOptions,
  SessionJson,
  SessionJsonOptions,
  SessionsJson,
} from './types'

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

/** One thread of a block as a session of the contract. */
export function threadToJson(
  thread: DayThread,
  block: DayBlock,
  { location, git, includeCategories }: SessionJsonOptions
): SessionJson {
  return {
    key: thread.key,
    project: sessionLocation(thread, location),
    repoName: thread.repoName,
    repoPath: git.repoPath,
    cwd: mostFrequentCwd(thread),
    branch: sessionBranch(thread.events),
    branches: branchesOf(thread.events),
    startedAt: thread.startedAt,
    endedAt: thread.endedAt,
    durationMinutes: minutesBetween(thread.startedAt, thread.endedAt),
    activeMinutes: toActiveMinutes(thread.activeSlots),
    eventCount: thread.eventCount,
    blockId: block.id,
    alongside: block.threads.filter((other) => other.id !== thread.id).map((other) => other.key),
    // Field by field, so a field added to `AgentSessionInfo` (WOR-136 adds more) never reaches the contract unasked
    agentSessions: thread.agentSessions.map(({ source, sessionId, startedAt, lastSeenAt }) => ({
      source,
      sessionId,
      startedAt,
      lastSeenAt,
    })),
    tickets: thread.tickets,
    notes: collectNotes(thread.events),
    commits: mergeCommits(collectCapturedCommits(thread.events), git.commits, git.othersSubjects),
    events: contractEvents(thread.events, includeCategories).map(eventToJson),
  }
}

export function blockToJson(block: DayBlock): BlockJson {
  return {
    id: block.id,
    startedAt: block.startedAt,
    endedAt: block.endedAt,
    eventCount: block.eventCount,
    activeMinutes: toActiveMinutes(block.activeSlots),
    threadKeys: block.threads.map((thread) => thread.key),
  }
}

export function buildSessionsJson(date: string, blocks: BlockJson[], sessions: SessionJson[]): SessionsJson {
  return { schemaVersion: SESSIONS_SCHEMA_VERSION, date, blocks, sessions }
}

export function buildEventsJson(
  date: string,
  rows: EventRow[],
  { limit, includeCategories }: EventsJsonOptions
): EventsJson {
  const events = contractEvents(rows, includeCategories)
  return {
    schemaVersion: EVENTS_SCHEMA_VERSION,
    date,
    total: events.length,
    events: events.slice(0, limit).map(eventToJson),
  }
}
