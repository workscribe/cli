// Whether a command's exit code is evidence about its test, build or lint run. The shell reports one code for the
// whole line, and it is not always the run's: `vitest run | tail` reports tail's, `vitest run || true` reports
// true's, `vitest run; echo done` reports echo's, `! vitest run` reports the opposite. A 0 from those says nothing, and
// reading it as "passing" hides a failure. This reads the shape of the command, never the tool, so it is the same for
// a tool nobody has used yet. It only ever turns a 0 into "unknown": a failure stays a failure. A shape it can't read
// (a group, a `$(…)`, an `if`, `time`, `pipefail`…) is unknown too, because a 0 it can't place is not worth trusting.
// Pure.
import { isGlueStep, STEP_SEPARATORS, stripHeredocBodies } from '../capture/command-steps'
import {
  containsCommandSubstitution,
  maskQuotedText,
  splitKeepingSeparators,
  stripComments,
  type SeparatedPart,
} from '../capture/shell-syntax'

const OUTCOME_CATEGORIES = new Set(['testing', 'building', 'linting'])
// A command with none of these is one plain command, whose exit code is its own
const HAS_STRUCTURE = /[|;&\n!]/
// Groups, backticks and options that change what a pipeline's or a list's exit code is. A here-doc is not one: it
// only feeds a command's input, so it changes nothing about whose exit code the line reports.
const UNREAD_SHAPE = /[({`]|\bpipefail\b/
// Commands that wrap, reorder or negate what runs, so whose exit code the line reports can't be read from it
const UNREAD_COMMANDS = new Set([
  '!',
  'if',
  'then',
  'else',
  'fi',
  'while',
  'until',
  'for',
  'case',
  'select',
  'do',
  'done',
  'time',
  'env',
  'exec',
  'eval',
  'xargs',
  'nohup',
  'trap',
  'set',
])
const PIPE = '|'
const BACKGROUND = '&'
const AND = '&&'

export interface ExitReport {
  command: string
  category: string
  exitCode: number | null
  /** The tool the event was stored with (`metadata.tool`), used to find which step of the line is the run */
  tool?: string | null
}

function startsWithUnreadCommand(step: string): boolean {
  return step.split(PIPE).some((stage) => {
    const [firstWord = ''] = stage.trim().split(/\s+/)
    return UNREAD_COMMANDS.has(firstWord)
  })
}

/** The steps of a line (its here-doc bodies already removed) with its quoted text blanked, so a `|` or `;` inside quotes is not read as shell syntax. */
function stepsOf(command: string): SeparatedPart[] {
  const unquoted = maskQuotedText(stripComments(command))
  return splitKeepingSeparators(unquoted, STEP_SEPARATORS).map((part) => ({ ...part, text: part.text.trim() }))
}

/** The tool as a word of its own: not part of a longer name, a flag or a file (`vitest.config.ts` is not `vitest`). */
function wordPattern(tool: string): RegExp {
  return new RegExp(`(?<![\\w.-])${tool.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w.-])`)
}

/** A pipe makes the exit code the last stage's: the run's own only when the tool is there and in no earlier stage. */
function hasPipeAfterRun(step: string, tool: string | null): boolean {
  if (!step.includes(PIPE)) return false
  if (tool === null) return true
  const stages = step.split(PIPE)
  const pattern = wordPattern(tool)
  return !pattern.test(stages[stages.length - 1]) || stages.slice(0, -1).some((stage) => pattern.test(stage))
}

function hasStepAfter(steps: SeparatedPart[], index: number): boolean {
  return steps.slice(index + 1).some((step) => step.text !== '')
}

/** Whether the line's exit code, once the step at `index` passes, can come from anything but that step. */
function isExitFromAnotherCommand(steps: SeparatedPart[], index: number, tool: string | null): boolean {
  if (hasPipeAfterRun(steps[index].text, tool)) return true
  return steps.slice(index).some((step, offset) => {
    if (step.separatorAfter === BACKGROUND) return true
    return step.separatorAfter !== null && step.separatorAfter !== AND && hasStepAfter(steps, index + offset)
  })
}

/** The steps that are the run: the ones naming the tool, else every step that does work (the line is then read whole). */
function runStepsOf(steps: SeparatedPart[], tool: string | null): { indexes: number[]; tool: string | null } {
  const workSteps = steps.flatMap((step, index) => (step.text !== '' && !isGlueStep(step.text) ? [index] : []))
  const pattern = tool === null ? null : wordPattern(tool)
  const namingTool = pattern === null ? [] : workSteps.filter((index) => pattern.test(steps[index].text))
  return namingTool.length > 0 ? { indexes: namingTool, tool } : { indexes: workSteps, tool: null }
}

/**
 * The exit code to report for an event: the stored one, or `null` (unknown) when a test, build or lint run's 0 can't be
 * credited to it. The run is the step that names the stored tool (every one that does, when several do); with no such
 * step the whole line is read, and any work step that doesn't pass on its own makes the 0 unknown. A run followed by
 * `&&` keeps its 0 (the line only gets there when it passed), so does one with nothing after it, however many `cd`s and
 * `echo`s come before it, and so does one that ends a pipeline (`cat in | tool`). A line with a shape this doesn't read
 * (a group, `$(…)`, `if`, `time`, `!`, `pipefail`…) gets no credit either.
 */
export function reportedExitCode({ command, category, exitCode, tool = null }: ExitReport): number | null {
  if (exitCode !== 0 || !OUTCOME_CATEGORIES.has(category) || !HAS_STRUCTURE.test(command)) return exitCode
  const withoutBodies = stripHeredocBodies(command)
  if (containsCommandSubstitution(withoutBodies)) return null
  const steps = stepsOf(withoutBodies)
  if (steps.some((step) => UNREAD_SHAPE.test(step.text) || startsWithUnreadCommand(step.text))) return null
  const run = runStepsOf(steps, tool)
  if (run.indexes.length === 0) return exitCode
  return run.indexes.some((index) => isExitFromAnotherCommand(steps, index, run.tool)) ? null : exitCode
}
