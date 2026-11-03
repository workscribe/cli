import type { EventRow } from '../db/types'
import { parseSessionKey } from './store'

// Which events a summary describes, and which thread it belongs to (pure). A summary is anchored to a project and
// the first and last events of its range; the thread it attaches to is worked out when it's read, since threads are
// rebuilt whenever a day changes.

/** A summary belongs to a project only when that project holds more than this share of its events. */
export const MAJORITY_SHARE = 0.5

/** What a stored summary is anchored to. */
export interface AnchorRange {
  /** Null for "elsewhere", or when the events aren't linked to projects yet */
  projectId: number | null
  firstEventId: number | null
  lastEventId: number | null
}

export interface SummaryAnchor extends AnchorRange {
  /** How much of the range the project holds, 0–1 */
  share: number
  /** The range mixed projects: the project held half of it or less, so the summary may describe other work */
  isMixed: boolean
  /** The key names a repo, but none of its events is linked to a project yet */
  isUnlinked: boolean
}

const UNANCHORED: SummaryAnchor = {
  projectId: null,
  firstEventId: null,
  lastEventId: null,
  share: 0,
  isMixed: false,
  isUnlinked: false,
}

function inSessionOrder(events: EventRow[]): EventRow[] {
  return [...events].sort(
    (first, second) => first.captured_at.localeCompare(second.captured_at) || first.id - second.id
  )
}

/** The project most of these events link to; a tie goes to the lowest id. Null when none is linked. */
function mostLinkedProject(events: EventRow[]): number | null {
  const counts = new Map<number, number>()
  for (const event of events) {
    const projectId = event.project_id ?? null
    if (projectId === null) continue
    counts.set(projectId, (counts.get(projectId) ?? 0) + 1)
  }
  const [best] = [...counts.entries()].sort(
    ([firstId, firstCount], [secondId, secondCount]) => secondCount - firstCount || firstId - secondId
  )
  return best?.[0] ?? null
}

/**
 * The anchor of an old session's summary: its first and last events in session order, and the project most of
 * its events named by the key link to (null for a key with no repo name: "elsewhere").
 */
export function anchorOfSession(events: EventRow[], keyRepoName: string | null): SummaryAnchor {
  if (events.length === 0) return UNANCHORED
  const ordered = inSessionOrder(events)
  const range = { firstEventId: ordered[0].id, lastEventId: ordered[ordered.length - 1].id }
  const projectId =
    keyRepoName === null ? null : mostLinkedProject(ordered.filter((event) => event.repo_name === keyRepoName))
  if (keyRepoName !== null && projectId === null) {
    return { ...UNANCHORED, ...range, isUnlinked: true }
  }
  const held = ordered.filter((event) => (event.project_id ?? null) === projectId).length
  const share = held / ordered.length
  return { ...range, projectId, share, isMixed: share <= MAJORITY_SHARE, isUnlinked: false }
}

/** The anchor of the session a `repo|started_at` key names, from that session's events. */
export function anchorOfKeyedSession(events: EventRow[], key: string): SummaryAnchor {
  return anchorOfSession(events, parseSessionKey(key)?.repoName ?? null)
}

/** A thread's anchor: one project's events, so never mixed. */
export interface ThreadAnchor extends AnchorRange {
  isMixed: false
}

/** The anchor of a summary saved for a thread: its project, and its first and last events in grouping order. */
export function anchorOfThread(events: EventRow[], projectId: number | null): ThreadAnchor {
  return {
    projectId,
    firstEventId: events[0]?.id ?? null,
    lastEventId: events.at(-1)?.id ?? null,
    isMixed: false,
  }
}

/** What attaching a stored summary to a thread reads. */
export interface StoredAnchor extends AnchorRange {
  /** Saved for a thread by `sessions summary set`, rather than for an old session */
  isThreadSaved: boolean
}

export interface BlockEvent {
  id: number
  threadId: number
}

export interface CandidateThread {
  id: number
  projectId: number | null
}

/**
 * The thread a summary belongs to, in the block holding its first event: its project's thread, when that thread
 * holds more than half of the block's events from the first event to the last (or to the block's end, if the last
 * is outside it). A summary saved for a thread needs only its first event to still be in that thread: a small
 * thread worked in between a busier project's events never holds most of its own range. Null for an unanchored
 * summary, a day with no threads built, or a range that mixed projects.
 */
export function findSummaryThread(
  anchor: StoredAnchor,
  block: { threads: CandidateThread[]; events: BlockEvent[] }
): CandidateThread | null {
  const start = block.events.findIndex((event) => event.id === anchor.firstEventId)
  if (start === -1) return null
  const thread = block.threads.find((candidate) => candidate.projectId === anchor.projectId)
  if (!thread) return null
  if (anchor.isThreadSaved) return block.events[start].threadId === thread.id ? thread : null
  const end = block.events.findIndex((event) => event.id === anchor.lastEventId)
  const rangeEvents = block.events.slice(start, end === -1 ? block.events.length : end + 1)
  const held = rangeEvents.filter((event) => event.threadId === thread.id).length
  return held / rangeEvents.length > MAJORITY_SHARE ? thread : null
}
