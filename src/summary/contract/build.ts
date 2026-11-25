import { branchesOf, eventRowToPayload, mostFrequentCwd, sessionBranch, sessionLocation } from '../payload'
import { EVENTS_SCHEMA_VERSION, HISTORY_SCHEMA_VERSION, SESSIONS_SCHEMA_VERSION } from './constants'
import { collectNotes, contractEvents } from './utils'
import { collectCapturedCommits, mergeCommits } from '../commits'
import { minutesBetween } from '../../sessions/grouper'
import { toActiveMinutes } from '../../sessions/blocks'
import { knownCount, sumKnown } from '../../ai/engines/template/changes'
import { parseMetadata, withoutIntent } from '../event-metadata'
import type { History, HistoryEntry } from '../history'
import type { EventRow } from '../../db/types'
import type { AgentSessionInfo } from '../../db/agent-sessions'
import type { DayBlock, DayThread } from '../../db/day-threads'
import type {
  AgentSessionJson,
  BlockJson,
  EventJson,
  EventsJson,
  EventsJsonOptions,
  SessionJson,
  SessionJsonOptions,
  SessionsJson,
  HistoryEntryJson,
  HistoryJson,
} from './types'

/**
 * Never includes the full command, the event's cwd or an IDE file path. What the agent said the command is for
 * (`metadata.intent`) is free text of the agent's: it goes out only when `includeIntent` says it may, like a recap.
 */
export function eventToJson(row: EventRow, { includeIntent = false }: { includeIntent?: boolean } = {}): EventJson {
  const { category, metadata: storedMetadata, hint, exitCode, durationMs } = eventRowToPayload(row)
  const metadata =
    includeIntent && typeof storedMetadata.intent === 'string' ? storedMetadata : withoutIntent(storedMetadata)
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

/** What the thread's events from one agent conversation add up to: commands, files, lines — never paths. */
function agentSessionCounts(
  events: EventRow[]
): Pick<AgentSessionJson, 'commandCount' | 'filesChanged' | 'linesAdded' | 'linesRemoved'> {
  const edits = events.filter((event) => event.category === 'code_edit')
  const sumOf = (field: 'linesAdded' | 'linesRemoved') =>
    sumKnown(edits.map((edit) => knownCount(parseMetadata(edit.metadata)[field])))
  return {
    commandCount: events.length - edits.length,
    filesChanged: new Set(edits.flatMap((edit) => edit.file_path ?? [])).size,
    linesAdded: sumOf('linesAdded'),
    linesRemoved: sumOf('linesRemoved'),
  }
}

/** Field by field, so a field added to `AgentSessionInfo` never reaches the contract unasked. */
function agentSessionToJson(
  session: AgentSessionInfo,
  threadEvents: EventRow[],
  { includeRecap }: { includeRecap: boolean }
): AgentSessionJson {
  const ownEvents = threadEvents.filter((event) => event.agent_session_id === session.id)
  return {
    source: session.source,
    sessionId: session.sessionId,
    startedAt: session.startedAt,
    lastSeenAt: session.lastSeenAt,
    endedAt: session.endedAt,
    ...agentSessionCounts(ownEvents),
    ...(includeRecap && session.recap ? { recap: session.recap } : {}),
  }
}

/** One thread of a block as a session of the contract. */
export function threadToJson(
  thread: DayThread,
  block: DayBlock,
  { location, git, includeCategories, includeAgentRecaps }: SessionJsonOptions
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
    agentSessions: thread.agentSessions.map((agentSession) =>
      agentSessionToJson(agentSession, thread.events, { includeRecap: includeAgentRecaps === true })
    ),
    tickets: thread.tickets,
    notes: collectNotes(thread.events),
    commits: mergeCommits(collectCapturedCommits(thread.events), git.commits, git.othersSubjects),
    events: contractEvents(thread.events, includeCategories).map((row) =>
      eventToJson(row, { includeIntent: includeAgentRecaps === true })
    ),
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
  { limit, includeCategories, includeIntent }: EventsJsonOptions
): EventsJson {
  const events = contractEvents(rows, includeCategories)
  return {
    schemaVersion: EVENTS_SCHEMA_VERSION,
    date,
    total: events.length,
    events: events.slice(0, limit).map((row) => eventToJson(row, { includeIntent })),
  }
}

function historyEntryToJson(entry: HistoryEntry): HistoryEntryJson {
  return {
    capturedAt: entry.capturedAt,
    branch: entry.branch,
    source: entry.source,
    isGit: entry.isGit,
    exitCode: entry.exitCode,
    moves: entry.moves,
    recovery: entry.recovery,
  }
}

/** `history --json`: the entries without their commands, which stay in the text view. */
export function buildHistoryJson(repo: string, since: string, history: History): HistoryJson {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    repo,
    since,
    entries: history.entries.map(historyEntryToJson),
    leftStashed: history.leftStashed,
  }
}
