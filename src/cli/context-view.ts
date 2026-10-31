// What `context` tells about a stretch of work, whichever path found it: an old session, or a thread.
import { getEventsBySessionId, getSessionBranch, getSessionSummaries } from '../db'
import type { EventRow, SessionRow } from '../db/types'
import type { Session } from '../sessions/detector'
import { readConfig } from '../config'
import { renderSessionStory } from '../ai/engines/template/story'
import { sessionToPayload, locationContextFrom } from '../summary/payload'
import { pickBestSummary, sessionKey } from '../summary/store'
import type { ThreadContext, WorkSpan } from '../summary/thread-context'

export type { WorkSpan } from '../summary/thread-context'
import { minutesBetween } from '../sessions/grouper'
import type { ThreadAnswer } from './context-threads'

export interface ContextView extends WorkSpan {
  summary: string
  events: EventRow[]
  /** Null when the answer came from the old sessions */
  threaded: Pick<ThreadContext, 'thread' | 'block' | 'alongside'> | null
}

/**
 * A template summary rendered from the span's events — templates are never stored, so it can't go stale. It tells
 * only the commits Workscribe captured: no git lookups, so the VS Code extension's 5 s answer holds.
 */
function renderTemplateSummary(id: number, span: WorkSpan, events: EventRow[]): string {
  const session: Session = { id, ...span, summary: null, events }
  const config = readConfig()
  const payload = sessionToPayload(session, span.date, { context: locationContextFrom(config) })
  return renderSessionStory(payload, config.summary?.includeCategories ?? [])
}

export function sessionViewOf(row: SessionRow): ContextView {
  const events = getEventsBySessionId(row.id)
  const span: WorkSpan = {
    repoName: row.repo_name,
    date: row.date,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    durationMinutes: minutesBetween(row.started_at, row.ended_at),
    branch: getSessionBranch(row.id),
    eventCount: row.event_count,
  }
  // The best stored summary (skill > AI > template), or a template one so the VS Code status bar is never empty
  const stored = pickBestSummary(getSessionSummaries(sessionKey(row.repo_name, row.started_at)))
  return { ...span, summary: stored ?? renderTemplateSummary(row.id, span, events), events, threaded: null }
}

export function threadViewOf({ threadId, context, events }: ThreadAnswer): ContextView {
  const { savedSummary, thread, block, alongside, ...span } = context
  return {
    ...span,
    summary: savedSummary ?? renderTemplateSummary(threadId, span, events),
    events,
    threaded: { thread, block, alongside },
  }
}
