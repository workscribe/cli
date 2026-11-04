import type { MigrationDatabase } from './migration-types'
import type { EventRow } from './types'
import { withReadTransaction } from './transaction'
import { getThreadEvents, readBlocksForDate, type StoredBlock, type StoredThread } from './thread-store'
import { getAnchoredSummariesInBlock, getProjectNames } from './context-lookup'
import { getAgentSessionsOfEvents, type AgentSessionInfo } from './agent-sessions'
import { sessionKey } from '../summary/store'
import { areJobsDone } from './jobs/state'
import type { DataJob } from './jobs/types'
import type { SummaryRow } from './summary-store'

// A day's built work blocks with what `sessions` says about each thread, read in one snapshot so another process
// rebuilding the day can't split the read. `node:sqlite`-free, so tests run it on an in-memory database.

/**
 * The jobs readers of threads wait for: until old events are linked to projects, threads would put them all
 * "elsewhere"; until old summaries are anchored, a thread would miss its summary.
 */
export const THREAD_READ_JOBS: ReadonlySet<string> = new Set(['project-dimensions', 'summary-anchors'])

/**
 * Whether threads can be read: once `THREAD_READ_JOBS` are done, or straight away for a database with no events
 * yet — a fresh install has nothing to upgrade, and its jobs only run before the data commands.
 */
export function isReadyForThreads(db: MigrationDatabase, jobs: DataJob[]): boolean {
  const hasEvents = db.prepare('SELECT 1 FROM events LIMIT 1').get() !== undefined
  return !hasEvents || areJobsDone(db, jobs, THREAD_READ_JOBS)
}

export interface DayThread extends StoredThread {
  /** `project|startedAt` — the same key `context` gives this thread */
  key: string
  /** The project's name; null for the block's "elsewhere" thread */
  repoName: string | null
  /** In grouping order */
  events: EventRow[]
  agentSessions: AgentSessionInfo[]
}

export interface DayBlock extends Omit<StoredBlock, 'threads'> {
  /** In the order their projects first appear in the block */
  threads: DayThread[]
  /** The anchored summaries whose range starts in this block — the ones that can belong to one of its threads */
  summaries: SummaryRow[]
}

function projectIdsOf(blocks: StoredBlock[]): number[] {
  const projectIds = blocks.flatMap((block) => block.threads.map((thread) => thread.projectId))
  return [...new Set(projectIds)].filter((projectId): projectId is number => projectId !== null)
}

function toDayThread(db: MigrationDatabase, thread: StoredThread, projectNames: Map<number, string | null>): DayThread {
  const repoName = thread.projectId === null ? null : (projectNames.get(thread.projectId) ?? null)
  const events = getThreadEvents(db, thread.id)
  return {
    ...thread,
    key: sessionKey(repoName, thread.startedAt),
    repoName,
    events,
    agentSessions: getAgentSessionsOfEvents(
      db,
      events.map((event) => event.id)
    ),
  }
}

/** The day's blocks as last built (`ensureDayThreads` builds them), in time order. */
export function readDayThreads(db: MigrationDatabase, date: string): DayBlock[] {
  return withReadTransaction(db, () => {
    const blocks = readBlocksForDate(db, date)
    const projectNames = getProjectNames(db, projectIdsOf(blocks))
    return blocks.map((block) => {
      const threads = block.threads.map((thread) => toDayThread(db, thread, projectNames))
      const eventIds = threads.flatMap((thread) => thread.events.map((event) => event.id))
      return { ...block, threads, summaries: getAnchoredSummariesInBlock(db, eventIds) }
    })
  })
}
