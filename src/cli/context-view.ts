// What `context` tells about the thread it answers with.
import type { EventRow } from '../db/types'
import type { AgentSessionInfo } from '../db/agent-sessions'
import { readConfig } from '../config'
import { renderSessionStory } from '../ai/engines/template/story'
import { spanToPayload, locationContextFrom } from '../summary/payload'
import type { ThreadContext, WorkSpan } from '../summary/thread-context'
import type { ThreadAnswer } from './context-threads'

export type { WorkSpan } from '../summary/thread-context'

export interface ContextView extends WorkSpan {
  summary: string
  events: EventRow[]
  agentSessions: AgentSessionInfo[]
  threaded: Pick<ThreadContext, 'thread' | 'block' | 'alongside'>
}

/**
 * A template summary rendered from the span's events — templates are never stored, so it can't go stale. It tells
 * only the commits Workscribe captured: no git lookups, so the VS Code extension's 5 s answer holds.
 */
function renderTemplateSummary(span: WorkSpan, events: EventRow[], agentSessions: AgentSessionInfo[]): string {
  const config = readConfig()
  const payload = spanToPayload({ ...span, events }, span.date, {
    context: locationContextFrom(config),
    agentSessions,
  })
  return renderSessionStory(payload, config.summary?.includeCategories ?? [])
}

export function threadViewOf({ context, events, agentSessions }: ThreadAnswer): ContextView {
  const { savedSummary, thread, block, alongside, ...span } = context
  return {
    ...span,
    // The best stored summary for the thread, or the template's so the VS Code status bar is never empty
    summary: savedSummary ?? renderTemplateSummary(span, events, agentSessions),
    events,
    agentSessions,
    threaded: { thread, block, alongside },
  }
}
