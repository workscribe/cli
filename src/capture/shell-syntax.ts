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

// A `#` starts a comment only at the start of a word: `$#`, `${#x}` and `a#b` are not comments.
// (bash and agents' shells treat it this way; interactive zsh only does with `interactivecomments` set.)
const WORD_BOUNDARY = /[\s;&|()]/

/** Where the first `# …` comment starts (outside quotes, at the start of a word), or -1. */
export function commentStart(text: string): number {
  for (const { index, quote } of quotedCharacters(text)) {
    if (quote !== null || text[index] !== '#') continue
    if (index === 0 || WORD_BOUNDARY.test(text[index - 1])) return index
  }
  return -1
}

/**
 * Removes `# …` comments up to the end of each line. Quote tracking restarts after each comment, so an
 * apostrophe inside one (`# let's check`) can't leave a quote "open" for the rest of the command.
 */
export function stripComments(text: string): string {
  let result = ''
  let rest = text
  for (let start = commentStart(rest); start !== -1; start = commentStart(rest)) {
    result += rest.slice(0, start)
    const lineEnd = rest.indexOf('\n', start)
    if (lineEnd === -1) return result
    rest = rest.slice(lineEnd)
  }
  return result + rest
}

/**
 * The text with everything inside quotes (and the quote marks and escapes themselves) replaced by `_`, keeping
 * every position — so a pattern can be matched against the unquoted parts only and applied to the original.
 */
export function maskQuotedText(text: string): string {
  const masked = Array.from({ length: text.length }, () => '_')
  for (const { index, quote } of quotedCharacters(text)) {
    if (quote === null) masked[index] = text[index]
  }
  return masked.join('')
}

export function startsWithWord(step: string, word: string): boolean {
  return step === word || step.startsWith(`${word} `) || step.startsWith(`${word}\t`)
}
