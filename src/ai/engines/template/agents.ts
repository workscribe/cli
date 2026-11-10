// Who counts as a coding agent, and how a summary says so. Read as static data from the shipped registry: the template
// is pure, so it never loads the user's `~/.workscribe/ai-tools.json` (`src/config/registry.ts`).
import AI_TOOLS from '../../../config/ai-tools.json'
import { pluralize } from './utils'
import type { EventPayload } from '../../types'

// An event's source is the `hook` that captured it, so a tool with no hook, or `vscode`, is never an agent
const AGENT_NAMES = new Map(AI_TOOLS.flatMap((tool) => (tool.hook ? [[tool.hook, tool.displayName] as const] : [])))

/** Whether an event came from a coding agent's hook rather than a person, in a terminal or an editor. */
export function isAgentEvent(event: Pick<EventPayload, 'source'>): boolean {
  return event.source !== undefined && AGENT_NAMES.has(event.source)
}

/** The display name of the coding agent behind a hook source (`claude-code` → "Claude Code"), or null for a non-agent. */
export function agentNameOf(source: string | undefined): string | null {
  return (source !== undefined && AGENT_NAMES.get(source)) || null
}

/** The file saves a person made in their editor — `code_edit` events no coding agent made. */
export function editorSavesOf(events: EventPayload[]): EventPayload[] {
  return events.filter((event) => event.category === 'code_edit' && !isAgentEvent(event))
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export interface AgentWork {
  /** "Claude Code", "Claude Code and Cursor" */
  names: string
  /** The distinct agent sessions: an event with no session id adds nothing */
  sessionIds: Set<number>
}

/** The coding agents that worked on these events, or null when none did. */
export function agentWorkOf(events: EventPayload[]): AgentWork | null {
  const agentEvents = events.filter(isAgentEvent)
  if (agentEvents.length === 0) return null
  const names = [...new Set(agentEvents.flatMap((event) => agentNameOf(event.source) ?? []))]
  return { names: joinNames(names), sessionIds: new Set(agentEvents.flatMap((event) => event.agentSessionId ?? [])) }
}

/**
 * "Claude Code (2 sessions)", "Claude Code and Cursor (3 sessions)", or null when no agent worked on these events. The
 * count is the distinct sessions: with no session id at all there's no count.
 */
export function describeAgents(events: EventPayload[]): string | null {
  const work = agentWorkOf(events)
  if (work === null) return null
  return work.sessionIds.size > 0 ? `${work.names} (${pluralize(work.sessionIds.size, 'session')})` : work.names
}
