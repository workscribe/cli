// Just enough shell syntax to find command boundaries in captured commands — quotes, escapes,
// separators and substitutions — without a full parser. Pure and total: never throws.

type QuoteState = '"' | "'" | null

interface QuotedCharacter {
  index: number
  quote: QuoteState
}

// `$(…)` and backticks run a command inside another, also inside double quotes. `<(…)` and `>(…)`
// run one as a file, but only unquoted — inside double quotes they are plain text.
const COMMAND_SUBSTITUTION_OPENER = '$('
const PROCESS_SUBSTITUTION_OPENERS = ['<(', '>(']

/**
 * Every character that is content rather than syntax, with the quote it sits in. Quote marks
 * themselves and backslash-escaped characters are skipped — they can't separate or substitute.
 */
function* quotedCharacters(text: string): Generator<QuotedCharacter> {
  let quote: QuoteState = null
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (character === '\\' && quote !== "'") {
      index++
      continue
    }
    if (character === quote) {
      quote = null
      continue
    }
    if (quote === null && (character === '"' || character === "'")) {
      quote = character
      continue
    }
    yield { index, quote }
  }
}

export function isOutsideQuotes(text: string, position: number): boolean {
  for (const { index, quote } of quotedCharacters(text)) {
    if (index >= position) return quote === null
  }
  return true
}

/** A lone `&` runs the step before it in the background; `2>&1`, `&>` and `>&` are redirections, not separators. */
function isRedirection(text: string, index: number): boolean {
  return text[index] === '&' && (text[index - 1] === '>' || text[index - 1] === '<' || text[index + 1] === '>')
}

/** Splits on any separator that sits outside single or double quotes. */
export function splitOutsideQuotes(text: string, separators: string[]): string[] {
  const parts: string[] = []
  let partStart = 0
  let skipUntil = 0
  for (const { index, quote } of quotedCharacters(text)) {
    if (quote !== null || index < skipUntil || isRedirection(text, index)) continue
    const separator = separators.find((candidate) => text.startsWith(candidate, index))
    if (!separator) continue
    parts.push(text.slice(partStart, index))
    partStart = index + separator.length
    skipUntil = partStart
  }
  parts.push(text.slice(partStart))
  return parts.map((part) => part.trim()).filter((part) => part !== '')
}

/** Command or process substitution outside single quotes: the shell runs another command inside this one. */
export function containsCommandSubstitution(text: string): boolean {
  for (const { index, quote } of quotedCharacters(text)) {
    if (quote === "'") continue
    if (text[index] === '`' || text.startsWith(COMMAND_SUBSTITUTION_OPENER, index)) return true
    if (quote === null && PROCESS_SUBSTITUTION_OPENERS.some((opener) => text.startsWith(opener, index))) return true
  }
  return false
}

export function startsWithWord(step: string, word: string): boolean {
  return step === word || step.startsWith(`${word} `) || step.startsWith(`${word}\t`)
}
