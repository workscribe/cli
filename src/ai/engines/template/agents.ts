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

/** The file saves a person made in their editor — `code_edit` events no coding agent made. */
export function editorSavesOf(events: EventPayload[]): EventPayload[] {
  return events.filter((event) => event.category === 'code_edit' && !isAgentEvent(event))
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * "Claude Code (2 sessions)", "Claude Code and Cursor (3 sessions)", or null when no agent worked on these events. The
 * count is the distinct sessions: an event with no session id adds nothing, and with none at all there's no count.
 */
export function describeAgents(events: EventPayload[]): string | null {
  const agentEvents = events.filter(isAgentEvent)
  if (agentEvents.length === 0) return null
  const names = [...new Set(agentEvents.map((event) => AGENT_NAMES.get(event.source as string) as string))]
  const sessionIds = new Set(agentEvents.flatMap((event) => event.agentSessionId ?? []))
  return sessionIds.size > 0 ? `${joinNames(names)} (${pluralize(sessionIds.size, 'session')})` : joinNames(names)
}
