// The agent's recap as one short phrase for the closing line. Pure.
import type { AgentSessionPayload } from '../../types'

const RECAP_MAX_CHARS = 100
const ELLIPSIS = '…'
// A sentence ends at a full stop and a capital: "e.g. the parser" doesn't end one
const SENTENCE_END = /(?<=[.!?])\s+(?=[A-Z0-9])/
// Markdown the agent starts a line with: headings, bullets, quotes, numbering
const LINE_MARKER = /^\s*(?:#{1,6}|[-*>]|\d+[.)])\s*/

/** The recap's first line with any words, without its markdown marker. */
function firstLineOf(recap: string): string {
  const lines = recap.split('\n').map((line) => line.replace(LINE_MARKER, '').trim())
  return lines.find((line) => line !== '') ?? ''
}

/** The recap's first sentence on one line, without its final full stop, cut to a short length. */
export function shortRecap(recap: string): string {
  const [firstSentence = ''] = firstLineOf(recap).split(SENTENCE_END)
  const phrase = firstSentence.trim().replace(/[.!?]+$/, '')
  if (phrase.length <= RECAP_MAX_CHARS) return phrase
  return `${phrase.slice(0, RECAP_MAX_CHARS - 1).trimEnd()}${ELLIPSIS}`
}

/**
 * The latest recap among these agent sessions (by when each was last seen) — null when none has one. A newer session
 * with no recap is skipped: its work is still told, and the last thing an agent said is the best account there is.
 */
export function latestRecapOf(sessions: AgentSessionPayload[]): string | null {
  const withRecap = sessions.filter((session) => session.recap !== null && session.recap.trim() !== '')
  const latest = withRecap.sort((first, second) => second.lastSeenAt.localeCompare(first.lastSeenAt))[0]
  return latest?.recap ?? null
}
