// Recognises Workscribe's own commands inside compound shell input, so a coding agent running the
// Workscribe skill (`cd repo && workscribe …`, `… | workscribe …`, heredocs) isn't captured as work.
// Works on the raw command: heredocs and newlines are lost once whitespace is collapsed.
import { containsCommandSubstitution, isOutsideQuotes, splitOutsideQuotes, startsWithWord } from './shell-syntax'

const STEP_SEPARATORS = ['&&', '||', ';', '\n', '&']
const PIPE_SEPARATORS = ['|']
// Commands that only produce text, so piping them into workscribe is still just Workscribe's own work
const TEXT_SOURCES = ['echo', 'printf']
// Steps that do no work of their own when they run nothing inside them
const GLUE_COMMANDS = ['cd', 'true', ':', ...TEXT_SOURCES]
// `<<TAG`, `<<-TAG`, `<<'TAG'`, `<<"TAG"` — but not a `<<<` here-string
const HEREDOC_OPENER = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g

/** Removes heredoc bodies, keeping the line that opens each one, so their text can't look like commands. */
export function stripHeredocBodies(command: string): string {
  const kept: string[] = []
  const pendingTerminators: string[] = []
  for (const line of command.split('\n')) {
    if (pendingTerminators.length > 0) {
      if (line.trim() === pendingTerminators[0]) pendingTerminators.shift()
      continue
    }
    kept.push(line)
    for (const match of line.matchAll(HEREDOC_OPENER)) {
      // `"a<<b"` is text inside quotes and `\<<` is an escaped `<`, neither opens a heredoc
      const isEscaped = line[match.index - 1] === '\\'
      if (!isEscaped && isOutsideQuotes(line, match.index)) pendingTerminators.push(match[2])
    }
  }
  return kept.join('\n')
}

/** The steps a shell runs: split on newlines, `&&`, `||`, `;` and a background `&`, outside quotes. */
export function splitSteps(command: string): string[] {
  return splitOutsideQuotes(command, STEP_SEPARATORS)
}

/**
 * A step is Workscribe's when it starts with `workscribe` (whatever it's piped into), or when it only
 * pipes text into it (`echo … | workscribe …`). `npm test | workscribe note done` still ran the tests,
 * and so does `workscribe note "$(npm test)"`, so neither is.
 */
function isWorkscribeStep(step: string): boolean {
  if (containsCommandSubstitution(step)) return false
  const stages = splitOutsideQuotes(step, PIPE_SEPARATORS)
  if (startsWithWord(stages[0] ?? '', 'workscribe')) return true
  const isTextOrWorkscribe = (stage: string): boolean =>
    startsWithWord(stage, 'workscribe') || TEXT_SOURCES.some((source) => startsWithWord(stage, source))
  return stages.every(isTextOrWorkscribe) && stages.some((stage) => startsWithWord(stage, 'workscribe'))
}

/**
 * Shell glue that does no work of its own — `cd`, `true`, `:`, or printing text — as long as it runs
 * nothing inside it and pipes nothing. Agents wrap commands in these (`… || true`, `; echo "exit=$?"`).
 */
function isGlueStep(step: string): boolean {
  if (containsCommandSubstitution(step) || splitOutsideQuotes(step, PIPE_SEPARATORS).length > 1) return false
  return GLUE_COMMANDS.some((command) => startsWithWord(step, command))
}

/**
 * True when the command does nothing but run Workscribe — possibly wrapped in shell glue (`cd`,
 * `|| true`, `; echo $?`), piped into, or with a heredoc. A command that also does real work
 * (`npm test && workscribe note …`) is not Workscribe-only.
 */
export function isWorkscribeOnlyCommand(rawCommand: string): boolean {
  const steps = splitSteps(stripHeredocBodies(rawCommand))
  const workSteps = steps.filter((step) => !isGlueStep(step))
  return workSteps.length > 0 && workSteps.every(isWorkscribeStep)
}
