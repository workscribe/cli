// Recognises Workscribe's own commands inside compound shell input, so a coding agent running the
// Workscribe skill (`cd repo && workscribe …`, `… | workscribe …`, heredocs) isn't captured as work.
// Works on the raw command: heredocs and newlines are lost once whitespace is collapsed.
import { containsCommandSubstitution, splitOutsideQuotes, startsWithWord } from './shell-syntax'
import { commandSteps, isGlueStep, TEXT_SOURCES } from './command-steps'

const PIPE_SEPARATORS = ['|']

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
 * True when the command does nothing but run Workscribe — possibly wrapped in shell glue (`cd`,
 * `|| true`, `; echo $?`), piped into, or with a heredoc. A command that also does real work
 * (`npm test && workscribe note …`) is not Workscribe-only.
 */
export function isWorkscribeOnlyCommand(rawCommand: string): boolean {
  const steps = commandSteps(rawCommand)
  const workSteps = steps.filter((step) => !isGlueStep(step))
  return workSteps.length > 0 && workSteps.every(isWorkscribeStep)
}
