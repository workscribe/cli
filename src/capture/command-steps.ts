// Breaks a captured shell command into the simple commands it runs, so each one can be classified or
// filtered on its own — agents run things like `cd app && pnpm nx test shell 2>&1 | tail -40; npx tsc`.
// Works on the raw command (heredocs and newlines are lost once whitespace is collapsed). Pure, never throws.
import {
  commentStart,
  containsCommandSubstitution,
  isOutsideQuotes,
  maskQuotedText,
  splitOutsideQuotes,
  startsWithWord,
  stripComments,
} from './shell-syntax'

const STEP_SEPARATORS = ['&&', '||', ';', '\n', '&']
const PIPE_SEPARATORS = ['|']
/** Commands that only produce text. */
export const TEXT_SOURCES = ['echo', 'printf']
// Steps that do no work of their own when they run nothing inside them
const GLUE_COMMANDS = ['cd', 'true', ':', ...TEXT_SOURCES]
// `<<TAG`, `<<-TAG`, `<<'TAG'`, `<<"TAG"` — but not a `<<<` here-string
const HEREDOC_OPENER = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g
// Words that wrap the command after them: `do npm test`, `if npm test`, `! grep x`, `time make`
const KEYWORD_PREFIX = /^(?:do|then|else|elif|if|while|until|time|!)\s+/
// Loop and case headers — shell structure, unless they run a command (`for f in $(npm test)`)
const STRUCTURE_HEADER = /^(?:for|select|case)\s/
// Closing keywords and bare keywords left over once a step is split
const STRUCTURE_KEYWORD = /^(?:done|fi|esac|\}|\)|do|then|else)$/
// `NAME=value` before a command (or on its own); the value may be quoted or a `$(…)` substitution
const LEADING_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\$\([^)]*\)|\S*)(?:\s+|$)/
// `2>&1`, `> file`, `2>/dev/null`, `&> log`, `>> file`, `< input`
const REDIRECTION = /(?:^|\s)(?:\d*>>?|&>>?|<)\s*(?:&\d+|[^\s;|&]+)/g
// Package-runner forms that mean "run this tool", rewritten to `npx …` so the npx rules recognise them
const TOOL_RUNNER = /^(?:(?:pnpm|yarn|npm)\s+exec|pnpm\s+dlx|bunx)\s+/
const FIRST_SUBSTITUTION = /\$\(([^()]*)\)/
// `$(…)` and backtick substitutions, for the commands inside them
const SUBSTITUTIONS = /\$\(([^()]*)\)|`([^`]*)`/g

/** The commands a line's `$(…)`/backtick substitutions run — what the shell executes from heredoc text. */
function substitutionCommands(line: string): string[] {
  return [...line.matchAll(SUBSTITUTIONS)]
    .map((match) => (match[1] ?? match[2] ?? '').trim())
    .filter((command) => command !== '')
}

/**
 * Removes heredoc bodies, keeping the line that opens each one, so their text can't look like commands.
 * The shell still runs `$(…)` inside an unquoted heredoc (`<<EOF`, not `<<'EOF'`), so the commands inside
 * those substitutions stay — each on its own line, without the surrounding text (whose apostrophes and
 * other characters would otherwise be read as shell syntax).
 */
export function stripHeredocBodies(command: string): string {
  const kept: string[] = []
  const pending: { terminator: string; runsSubstitutions: boolean }[] = []
  for (const line of command.split('\n')) {
    if (pending.length > 0) {
      if (line.trim() === pending[0].terminator) pending.shift()
      else if (pending[0].runsSubstitutions && containsCommandSubstitution(line))
        kept.push(...substitutionCommands(line))
      continue
    }
    kept.push(line)
    const comment = commentStart(line)
    for (const match of line.matchAll(HEREDOC_OPENER)) {
      // `"a<<b"` is text inside quotes, `\<<` an escaped `<` and `# see <<EOF` a comment — none opens a heredoc
      const isEscaped = line[match.index - 1] === '\\'
      const isInComment = comment !== -1 && match.index > comment
      if (isEscaped || isInComment || !isOutsideQuotes(line, match.index)) continue
      pending.push({ terminator: match[2], runsSubstitutions: match[1] === '' })
    }
  }
  return kept.join('\n')
}

/** The steps a shell runs: split on newlines, `&&`, `||`, `;` and a background `&`, outside quotes. */
export function splitSteps(command: string): string[] {
  return splitOutsideQuotes(command, STEP_SEPARATORS)
}

function countOf(text: string, character: string): number {
  return text.split(character).length - 1
}

/** `(cd app && npm test)` splits into `(cd app` and `npm test)` — drop the unbalanced group brackets. */
function withoutGroupBrackets(step: string): string {
  let unwrapped = step
  while (unwrapped.startsWith('(') && countOf(unwrapped, '(') > countOf(unwrapped, ')')) {
    unwrapped = unwrapped.slice(1).trim()
  }
  while (unwrapped.endsWith(')') && countOf(unwrapped, ')') > countOf(unwrapped, '(')) {
    unwrapped = unwrapped.slice(0, -1).trim()
  }
  if (unwrapped.startsWith('{ ')) unwrapped = unwrapped.slice(2).trim()
  return unwrapped
}

function withoutKeywordPrefixes(step: string): string {
  let unwrapped = step
  while (KEYWORD_PREFIX.test(unwrapped)) unwrapped = unwrapped.replace(KEYWORD_PREFIX, '')
  return unwrapped
}

function withoutLeadingAssignments(step: string): string {
  let unwrapped = step
  while (LEADING_ASSIGNMENT.test(unwrapped)) unwrapped = unwrapped.replace(LEADING_ASSIGNMENT, '')
  return unwrapped
}

/** `d=node_modules/x` does nothing on its own; `f=$(npm test)` still runs `npm test`, so it stays. */
function isPlainAssignment(step: string): boolean {
  return withoutLeadingAssignments(step) === '' && !containsCommandSubstitution(step)
}

/** Loop headers and closing keywords do no work — but a header that runs a command (`for f in $(ls)`) does. */
function isShellStructure(step: string): boolean {
  if (STRUCTURE_KEYWORD.test(step)) return true
  return STRUCTURE_HEADER.test(step) && !containsCommandSubstitution(step)
}

/** Removes redirections (`2>&1`, `> out.txt`) outside quotes — a `>` inside a commit message is kept. */
function withoutRedirections(command: string): string {
  const masked = maskQuotedText(command)
  let result = ''
  let copiedUpTo = 0
  for (const match of masked.matchAll(REDIRECTION)) {
    result += command.slice(copiedUpTo, match.index)
    copiedUpTo = match.index + match[0].length
  }
  return result + command.slice(copiedUpTo)
}

/**
 * The commands a captured shell line runs, in order: comments and heredoc bodies removed, split into steps,
 * group brackets and wrapping keywords (`do`, `then`, `if`…) removed, and loop headers, closing keywords and
 * plain assignments dropped.
 */
export function commandSteps(rawCommand: string): string[] {
  return splitSteps(stripComments(stripHeredocBodies(rawCommand)))
    .map((step) => withoutKeywordPrefixes(withoutGroupBrackets(step)))
    .filter((step) => step !== '' && !isShellStructure(step) && !isPlainAssignment(step))
}

/**
 * The command a step mainly runs, in a form the normalizer rules can match: leading assignments, everything
 * after the first `|`, and redirections removed; `pnpm exec tsc` read as `npx tsc`. For an assignment or a
 * loop header that runs a command (`f=$(find . -name x)`, `for f in $(npm test)`), the command inside.
 */
export function simpleCommandOf(step: string): string {
  const command = withoutLeadingAssignments(step)
  if (command === '' || STRUCTURE_HEADER.test(command)) return step.match(FIRST_SUBSTITUTION)?.[1]?.trim() ?? ''
  const [firstStage = ''] = splitOutsideQuotes(command, PIPE_SEPARATORS)
  return withoutRedirections(firstStage).replace(/\s+/g, ' ').trim().replace(TOOL_RUNNER, 'npx ')
}

/**
 * Shell glue that does no work of its own — `cd`, `true`, `:`, or printing text — as long as it runs
 * nothing inside it and pipes nothing. Agents wrap commands in these (`… || true`, `; echo "exit=$?"`).
 */
export function isGlueStep(step: string): boolean {
  if (containsCommandSubstitution(step) || splitOutsideQuotes(step, PIPE_SEPARATORS).length > 1) return false
  return GLUE_COMMANDS.some((command) => startsWithWord(step, command))
}
