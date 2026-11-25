// What the agent said its commands were for ("Run the retention tests"), as one short line for a block that has nothing
// else to tell. Stored only with `capture.agentMessages`, and in the payload only where recaps are shown. Pure.
import { agentWorkOf } from './agents'
import { shortRecap } from './recap'
import type { EventPayload } from '../../types'

const MAX_INTENTS = 3

function intentOf(event: EventPayload): string[] {
  const { intent } = event.metadata
  return typeof intent === 'string' && intent.trim() !== '' ? [shortRecap(intent)] : []
}

/**
 * "Claude Code: Check the plan; Show recent commits": up to three different intents of the agents' commands, in the
 * order they were given, each cut like a recap's first sentence. Null when no agent gave one.
 */
export function describeIntents(events: EventPayload[]): string | null {
  const agents = agentWorkOf(events)
  const intents = [...new Set(events.flatMap(intentOf))].filter((intent) => intent !== '').slice(0, MAX_INTENTS)
  return agents === null || intents.length === 0 ? null : `${agents.names}: ${intents.join('; ')}`
}
