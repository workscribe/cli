// Which tickets an event names (pure): keys matching the ticket pattern in its linked branch's name, and in the
// subjects of the commits it made. Used by capture and by the `ticket-refs` job, so both derive the same links.
import { collectCapturedCommits, type CommitSource } from '../summary/commits'
import type { TicketKeys } from '../db/tickets'

export const DEFAULT_TICKET_PATTERN = '[A-Z][A-Z0-9]+-\\d+'

/** Only the start of a long text is searched: ticket keys sit at the start of branch names and subjects. */
const MAX_SEARCHED_CHARACTERS = 200

const REPEATS = new Set(['*', '+', '{'])
const VARIES = new Set(['*', '+', '?', '{', '|'])

/** Where a character class `[...]` that opens at `start` ends (its `]`), escapes inside skipped. */
function endOfClass(source: string, start: number): number {
  let index = start + 1
  if (source[index] === '^') index++
  if (source[index] === ']') index++
  while (index < source.length && source[index] !== ']') index += source[index] === '\\' ? 2 : 1
  return index
}

/**
 * Whether a group that repeats (`*`, `+`, `{…}`) holds anything that varies — a quantifier or an `|`, at any depth:
 * `(A+)+`, `((A+))+`, `(A|AA)+`. That is the shape that can backtrack exponentially on a near miss. Deliberately
 * conservative: it also refuses some safe patterns, such as `(?:-[A-Z]+)*`.
 */
function hasNestedRepetition(source: string): boolean {
  const groupsVary: boolean[] = []
  for (let index = 0; index < source.length; index++) {
    const character = source[index]
    if (character === '\\') {
      index++
    } else if (character === '[') {
      index = endOfClass(source, index)
    } else if (character === '(') {
      groupsVary.push(false)
      if (source[index + 1] === '?') index++
    } else if (character === ')') {
      const varies = groupsVary.pop() ?? false
      if (varies && REPEATS.has(source[index + 1])) return true
    } else if (VARIES.has(character)) {
      groupsVary.fill(true)
    }
  }
  return false
}

/** Why a ticket pattern can't be used, or null when it can. */
export function ticketPatternProblem(source: string): string | null {
  if (hasNestedRepetition(source)) {
    return 'it repeats a group that itself repeats or has alternatives, which can hang on a near miss'
  }
  let pattern: RegExp
  try {
    pattern = new RegExp(source)
  } catch (error) {
    return `it isn't a valid regular expression (${(error as Error).message})`
  }
  return pattern.test('') ? 'it matches empty text, so it would find a ticket everywhere' : null
}

/** The pattern to find ticket keys with: the configured one, or the default when it's missing or unusable. */
export function ticketPatternOf(source: unknown): RegExp {
  const usable = typeof source === 'string' && ticketPatternProblem(source) === null ? source : DEFAULT_TICKET_PATTERN
  return new RegExp(usable, 'g')
}

/**
 * The keys in a text's searched start. A match that runs into the cut may be a longer key cut short (`WOR-1234` read
 * as `WOR-1`), so it's dropped; so is an empty match, which a pattern like `[A-Z]*(?=-\d)` can make inside a text.
 */
function keysIn(text: string, pattern: RegExp): string[] {
  const searched = text.slice(0, MAX_SEARCHED_CHARACTERS)
  const isCut = text.length > searched.length
  return [...searched.matchAll(pattern)]
    .filter((match) => match[0] !== '' && !(isCut && match.index + match[0].length === searched.length))
    .map((match) => match[0])
}

function distinct(keys: string[]): string[] {
  return [...new Set(keys)]
}

/**
 * The keys an event names. Branch keys come from the branch the event is linked to — never its raw `branch` text,
 * which a save in another repo keeps without a link. A failed commit names nothing.
 */
export function ticketKeysOf(
  { linkedBranch, event }: { linkedBranch: string | null; event: CommitSource },
  pattern: RegExp
): TicketKeys {
  const subjects = collectCapturedCommits([event]).map((commit) => commit.subject)
  return {
    branch: linkedBranch === null ? [] : distinct(keysIn(linkedBranch, pattern)),
    commits: distinct(subjects.flatMap((subject) => keysIn(subject, pattern))),
  }
}
