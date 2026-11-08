// What Workscribe keeps of a coding agent's own words — its recap of a turn, or its compaction summary — when
// `capture.agentMessages` is on. Pure.
import { containsSecrets } from './detect-secrets'
import { redact } from './redact'

/** The most of one message kept: enough for a recap, never a whole transcript. */
export const AGENT_MESSAGE_MAX_CHARS = 2000
/** The most of a session's end reason kept: Claude Code sends one word, such as `other` or `logout`. */
export const END_REASON_MAX_CHARS = 64

/**
 * The message as stored, or null to store nothing. `redact()` was written for commands, not prose, so a message the
 * built-in secret check flags is dropped whole rather than partly redacted; the user's own patterns are still applied.
 */
export function storableAgentMessage(text: string, extraRedactions: string[]): string | null {
  if (containsSecrets(text)) return null
  const stored = capCharacters(redact(text, extraRedactions).trim(), AGENT_MESSAGE_MAX_CHARS)
  return stored === '' ? null : stored
}

/**
 * The end reason as stored. It's a word Claude Code chooses, never the user's text, so it's only capped: in case a
 * future version sends something longer.
 */
export function storableEndReason(reason: string | null): string | null {
  return reason === null ? null : capCharacters(reason, END_REASON_MAX_CHARS)
}

/** The first `limit` characters, never splitting one (an emoji is two UTF-16 units, which `slice` would cut apart). */
function capCharacters(text: string, limit: number): string {
  return Array.from(text).slice(0, limit).join('')
}
