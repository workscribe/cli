import type { EventRow } from '../db/types'
import type { StoredThread } from '../db/thread-store'
import type { SummaryRow } from '../db/summary-store'
import type { WorkBlockRow } from '../db/context-lookup'
import { toActiveMinutes } from '../sessions/blocks'
import { summariesOfThread, type BlockEvent } from './anchors'
import { minutesBetween } from '../sessions/grouper'
import { pickBestSummary, sessionKey } from './store'

// What `context` says on the thread path (pure): the thread an event belongs to, in its block, with the projects
// worked alongside it, and the summary that belongs to that thread.

export interface ThreadSpanJson {
  repoName: string | null
  startedAt: string
  endedAt: string
  eventCount: number
  activeMinutes: number
}

/** The fields every `context` answer has. */
export interface WorkSpan {
  repoName: string | null
  date: string
  startedAt: string
  endedAt: string
  durationMinutes: number
  branch: string | null
  eventCount: number
}

export interface ThreadContext extends WorkSpan {
  /** The best summary stored for this thread, or null: the caller renders the template from `events` */
  savedSummary: string | null
  thread: { key: string; projectId: number | null; activeMinutes: number }
  block: { startedAt: string; endedAt: string; activeMinutes: number }
  /** The block's other threads, in the order their projects first appear */
  alongside: ThreadSpanJson[]
}

export interface ThreadContextInput {
  block: WorkBlockRow
  threads: StoredThread[]
  blockEvents: BlockEvent[]
  thread: StoredThread
  /** The thread's own events, in grouping order */
  threadEvents: EventRow[]
  projectNames: Map<number, string | null>
  summaries: SummaryRow[]
}

function nameOf(thread: StoredThread, projectNames: Map<number, string | null>): string | null {
  return thread.projectId === null ? null : (projectNames.get(thread.projectId) ?? null)
}

function latestBranch(events: EventRow[]): string | null {
  return [...events].reverse().find((event) => event.branch)?.branch ?? null
}

/** The best stored summary that belongs to this thread, if any. */
function summaryOfThread(input: ThreadContextInput): string | null {
  const block = { threads: input.threads, events: input.blockEvents }
  return pickBestSummary(summariesOfThread(input.thread.id, block, input.summaries))
}

export function buildThreadContext(input: ThreadContextInput): ThreadContext {
  const { thread, block, projectNames } = input
  const repoName = nameOf(thread, projectNames)
  return {
    repoName,
    date: block.date,
    startedAt: thread.startedAt,
    endedAt: thread.endedAt,
    durationMinutes: minutesBetween(thread.startedAt, thread.endedAt),
    branch: latestBranch(input.threadEvents),
    eventCount: thread.eventCount,
    savedSummary: summaryOfThread(input),
    thread: {
      key: sessionKey(repoName, thread.startedAt),
      projectId: thread.projectId,
      activeMinutes: toActiveMinutes(thread.activeSlots),
    },
    block: { startedAt: block.startedAt, endedAt: block.endedAt, activeMinutes: toActiveMinutes(block.activeSlots) },
    alongside: input.threads
      .filter((other) => other.id !== thread.id)
      .map((other) => ({
        repoName: nameOf(other, projectNames),
        startedAt: other.startedAt,
        endedAt: other.endedAt,
        eventCount: other.eventCount,
        activeMinutes: toActiveMinutes(other.activeSlots),
      })),
  }
}
