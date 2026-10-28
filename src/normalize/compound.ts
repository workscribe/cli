// Classifies compound shell commands — `cd app && pnpm nx test shell 2>&1 | tail -40; npx tsc` — by their most
// telling step. Pure: the rule matcher is passed in, so this module doesn't load the rules (or the profiles).
import { commandSteps, isGlueStep, simpleCommandOf } from '../capture/command-steps'
import { DEFAULT_EXCLUDED_CATEGORIES } from '../summary/exclusions'
import type { NormalizedEvent } from './patterns'

/** Matches a step: `command` is its simple form (one line, redirections gone), `raw` the step as written. */
export type MatchCommand = (command: string, raw: string) => NormalizedEvent

export const UNCLASSIFIED: NormalizedEvent = { category: 'other', metadata: {} }

// When a compound command runs several things, the event takes the step that says most about the work:
// outcomes first, then routine work. `git status` (versioning) must never hide `npm test` next to it.
export const STEP_CATEGORY_PRIORITY = [
  'testing',
  'building',
  'releasing',
  'shipping',
  'dependencies',
  'database',
  'infrastructure',
  'running',
  'files',
  'versioning',
]

// Ranks after the priority list, lower is more telling: any other category, then ones summaries leave out, then `other`
const OTHER_CATEGORY_RANK = STEP_CATEGORY_PRIORITY.length
const EXCLUDED_CATEGORY_RANK = OTHER_CATEGORY_RANK + 1
const UNCLASSIFIED_RANK = EXCLUDED_CATEGORY_RANK + 1

function rankOf(category: string): number {
  const index = STEP_CATEGORY_PRIORITY.indexOf(category)
  if (index !== -1) return index
  if (category === UNCLASSIFIED.category) return UNCLASSIFIED_RANK
  if (DEFAULT_EXCLUDED_CATEGORIES.has(category)) return EXCLUDED_CATEGORY_RANK
  return OTHER_CATEGORY_RANK
}

/** The most telling step's event, and that step; ties go to the earlier step. */
function primaryStepEvent(steps: string[], matchCommand: MatchCommand): NormalizedEvent {
  const events = steps.map((step) => ({ ...matchCommand(simpleCommandOf(step), step), matchedStep: step }))
  return events.reduce<NormalizedEvent>(
    (best, event) => (rankOf(event.category) < rankOf(best.category) ? event : best),
    UNCLASSIFIED
  )
}

/**
 * A command the rules already recognise as it is, with nothing else to run, keeps that result. Otherwise it's
 * split into the commands it runs, shell glue (`cd`, `echo`, assignments, loop keywords) is set aside, and the
 * most telling step names the event — falling back to the whole command when no step is recognised either.
 */
export function classifyCompound(command: string, matchCommand: MatchCommand): NormalizedEvent {
  const workSteps = commandSteps(command).filter((step) => !isGlueStep(step))
  // Matched as a whole (so heredoc text inside it is still there), but it's the one work step that ran
  const wholeCommandEvent = {
    ...matchCommand(command, command),
    matchedStep: workSteps.length === 1 ? workSteps[0] : command,
  }
  const isRecognisedSingleCommand = workSteps.length <= 1 && wholeCommandEvent.category !== UNCLASSIFIED.category
  if (isRecognisedSingleCommand || workSteps.length === 0) return wholeCommandEvent

  const primaryEvent = primaryStepEvent(workSteps, matchCommand)
  return primaryEvent.category === UNCLASSIFIED.category ? wholeCommandEvent : primaryEvent
}
