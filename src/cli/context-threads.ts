// The I/O behind `context` on threads: finds the event to answer from, builds its day's threads (waiting ~1 s at
// most for the lock) and reads its block. Anything it can't answer — data not upgraded yet, the lock held, no
// thread — falls back to the old sessions, saying whether the lock was why, so the caller never waits twice.
import { getDb } from '../db'
import type { EventRow } from '../db/types'
import { isDatabaseLocked, withReadTransaction } from '../db/transaction'
import { getThreadEvents, readBlockHoldingEvent } from '../db/thread-store'
import {
  findLatestFileSave,
  findLatestProjectEvent,
  getAnchoredSummariesInBlock,
  getProjectNames,
  getWorkBlock,
  type EventPoint,
} from '../db/context-lookup'
import { JOBS } from '../db/jobs'
import { getJobRow, isJobDone } from '../db/jobs/store'
import { ensureDayThreads } from '../sessions/threads'
import { buildThreadContext, type ThreadContext } from '../summary/thread-context'
import { localDateOf } from '../utils/format'
import { LOCK_WAIT_MS } from './context-file'

/** Until these have run, old saves aren't linked to files and old summaries aren't anchored: the threads would miss them. */
const THREAD_CONTEXT_JOBS = new Set(['project-dimensions', 'summary-anchors'])

export interface ThreadAnswer {
  threadId: number
  context: ThreadContext
  /** The thread's events, for the template summary and the file details */
  events: EventRow[]
}

export type ThreadLookup = { kind: 'found'; answer: ThreadAnswer } | { kind: 'fallback'; isLocked: boolean }

const FALLBACK: ThreadLookup = { kind: 'fallback', isLocked: false }

/** Both jobs exist and are done. A name missing from `JOBS` counts as not done, so threads never answer too early. */
function areThreadJobsDone(): boolean {
  const db = getDb()
  const jobs = JOBS.filter((job) => THREAD_CONTEXT_JOBS.has(job.name))
  return jobs.length === THREAD_CONTEXT_JOBS.size && jobs.every((job) => isJobDone(getJobRow(db, job.name), job))
}

/** The thread holding the event, from one snapshot — so another process rebuilding the day can't split the read. */
function readBuiltThread(eventId: number): ThreadAnswer | null {
  const db = getDb()
  return withReadTransaction(db, () => {
    const holding = readBlockHoldingEvent(db, eventId)
    const threadId = holding?.events.find((blockEvent) => blockEvent.id === eventId)?.threadId
    const thread = holding?.threads.find((candidate) => candidate.id === threadId)
    const block = thread ? getWorkBlock(db, thread.blockId) : null
    if (!holding || !thread || !block) return null
    const projectIds = holding.threads.flatMap((other) => (other.projectId === null ? [] : [other.projectId]))
    const events = getThreadEvents(db, thread.id)
    const context = buildThreadContext({
      block,
      threads: holding.threads,
      blockEvents: holding.events,
      thread,
      threadEvents: events,
      projectNames: getProjectNames(db, projectIds),
      summaries: getAnchoredSummariesInBlock(
        db,
        holding.events.map((blockEvent) => blockEvent.id)
      ),
    })
    return { threadId: thread.id, context, events }
  })
}

function lookUpThreadOf(findEvent: () => EventPoint | null): ThreadLookup {
  try {
    if (!areThreadJobsDone()) return FALLBACK
    const event = findEvent()
    if (event === null) return FALLBACK
    ensureDayThreads(localDateOf(event.capturedAt), { lockWaitMs: LOCK_WAIT_MS })
    const answer = readBuiltThread(event.id)
    return answer === null ? FALLBACK : { kind: 'found', answer }
  } catch (error) {
    if (isDatabaseLocked(error)) return { kind: 'fallback', isLocked: true }
    throw error
  }
}

/** `context --file`: the thread holding the file's latest save. */
export function lookUpFileThread(filePath: string): ThreadLookup {
  return lookUpThreadOf(() => findLatestFileSave(getDb(), filePath))
}

/** `context`: the thread holding the latest event of the project with this identity. */
export function lookUpProjectThread(identity: string): ThreadLookup {
  return lookUpThreadOf(() => findLatestProjectEvent(getDb(), identity))
}
