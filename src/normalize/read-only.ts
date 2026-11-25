// The one list of commands that only read: the rules and the `read-only-commands` job both use it. Pure, and reads no
// config, because a data job may not. A command the list can't be sure of isn't read-only, so it stays in summaries.
import { commandSteps, isGlueStep, simpleCommandOf, substitutionCommands } from '../capture/command-steps'
import {
  containsCommandSubstitution,
  maskLiteralText,
  maskQuotedText,
  shellWords,
  splitOutsideQuotes,
} from '../capture/shell-syntax'
import { parseGitInvocation } from './git-invocation'

export const READ_ONLY_CATEGORY = 'exploring'

type ArgumentCheck = (args: string[]) => boolean

const PIPE_SEPARATORS = ['|']
const ALWAYS_READS = () => true

const GIT_READS = new Set(['diff', 'log', 'show', 'status'])
// `--output` writes a file; `--ext-diff` and `--textconv` run configured helpers
const GIT_UNSAFE_OPTIONS = ['--output', '--ext-diff', '--textconv']
const FIND_UNSAFE_ACTION = /^-(?:delete|exec|execdir|ok|okdir|fls|fprint\w*)$/

const SED_ADDRESS = String.raw`(?:\d+|\$|/(?:[^/\\]|\\.)*/)`
// An optional address or range, then print: `1,5p`, `/x/p`, `$=`. Sed's `w` and `e` commands write files and run commands
const SED_PRINT_COMMAND = new RegExp(String.raw`^(?:${SED_ADDRESS}(?:,${SED_ADDRESS})?)?\s*!?\s*[p=]$`)
const SED_SHORT_OPTIONS = /^-[a-zA-Z]+$/
const SED_UNSAFE_SHORT_OPTION = /[iIf]/

// `>`, `>>`, `2>`, `&>`, `>|`, and what they write to. `2>&1` and `/dev/null` keep nothing
const OUTPUT_REDIRECTION = /(?:&>>?|\d*>>?\|?)\s*(&?[^\s;|&()]*)/g
const HARMLESS_TARGET = /^(?:&\d+|\/dev\/null)$/
const PROCESS_SUBSTITUTION = /[<>]\(/

function hasNoOption(args: string[], options: string[]): boolean {
  return !args.some((arg) => options.some((option) => arg === option || arg.startsWith(`${option}=`)))
}

/** `python3 -c …`, `python3 -`, `node -e …`: the first thing that isn't an interpreter option has to be the inline flag. */
function runsInlineCode(args: string[], inlineFlags: string[]): boolean {
  const firstMeaningful = args.find(
    (arg) => inlineFlags.includes(arg) || arg.startsWith('--eval=') || !arg.startsWith('-')
  )
  return (
    firstMeaningful !== undefined && (inlineFlags.includes(firstMeaningful) || firstMeaningful.startsWith('--eval='))
  )
}

export interface SedArguments {
  isQuiet: boolean
  isSafe: boolean
  scripts: string[]
}

function readSedShortOptions(option: string, nextArg: string | undefined, parsed: SedArguments): number {
  const letters = option.slice(1)
  const expressionAt = letters.indexOf('e')
  if (SED_UNSAFE_SHORT_OPTION.test(letters) || (expressionAt !== -1 && expressionAt !== letters.length - 1)) {
    parsed.isSafe = false
  }
  if (letters.includes('n')) parsed.isQuiet = true
  if (expressionAt === -1) return 0
  parsed.scripts.push(nextArg ?? '')
  return 1
}

/** What a sed command line holds: its script options, and every other word (the script itself when no `-e` gave one). */
export function readSedArguments(args: string[]): SedArguments & { positional: string[] } {
  const parsed: SedArguments = { isQuiet: false, isSafe: true, scripts: [] }
  const positional: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--quiet' || arg === '--silent') parsed.isQuiet = true
    else if (arg.startsWith('--in-place') || arg.startsWith('--file')) parsed.isSafe = false
    else if (arg === '--expression') parsed.scripts.push(args[++index] ?? '')
    else if (arg.startsWith('--expression=')) parsed.scripts.push(arg.slice('--expression='.length))
    else if (SED_SHORT_OPTIONS.test(arg)) index += readSedShortOptions(arg, args[index + 1], parsed)
    else if (!arg.startsWith('-')) positional.push(arg)
  }
  return { ...parsed, positional }
}

function sedOnlyPrints(args: string[]): boolean {
  const { isQuiet, isSafe, scripts, positional } = readSedArguments(args)
  const allScripts = scripts.length > 0 ? scripts : positional.slice(0, 1)
  if (!isQuiet || !isSafe || allScripts.length === 0) return false
  return allScripts.every((script) =>
    script
      .split(';')
      .filter((part) => part.trim() !== '')
      .every((part) => SED_PRINT_COMMAND.test(part.trim()))
  )
}

const READERS: Record<string, ArgumentCheck> = {
  grep: ALWAYS_READS,
  egrep: ALWAYS_READS,
  fgrep: ALWAYS_READS,
  ag: ALWAYS_READS,
  ack: ALWAYS_READS,
  cat: ALWAYS_READS,
  bat: ALWAYS_READS,
  less: ALWAYS_READS,
  more: ALWAYS_READS,
  head: ALWAYS_READS,
  tail: ALWAYS_READS,
  ls: ALWAYS_READS,
  wc: ALWAYS_READS,
  // `--pre` runs a command on every file
  rg: (args) => hasNoOption(args, ['--pre']),
  ripgrep: (args) => hasNoOption(args, ['--pre']),
  find: (args) => !args.some((arg) => FIND_UNSAFE_ACTION.test(arg)),
  sed: sedOnlyPrints,
  python: (args) => runsInlineCode(args, ['-c', '-']),
  python3: (args) => runsInlineCode(args, ['-c', '-']),
  node: (args) => runsInlineCode(args, ['-e', '--eval']),
}

// Only filter the text piped into them, so they don't read anything of their own
const PIPE_FILTERS: Record<string, ArgumentCheck> = {
  sort: (args) => hasNoOption(args, ['-o', '--output']) && !args.some((arg) => /^-[a-zA-Z]*o/.test(arg)),
  // `uniq in out` writes to `out`
  uniq: (args) => args.filter((arg) => !arg.startsWith('-')).length <= 1,
  cut: ALWAYS_READS,
  tr: ALWAYS_READS,
  jq: ALWAYS_READS,
}

function isGitRead(command: string): boolean {
  const invocation = parseGitInvocation(command)
  if (!invocation?.subcommand) return false
  const args = invocation.args.map(({ word }) => word)
  if (invocation.subcommand === 'branch') return args.length === 0
  return GIT_READS.has(invocation.subcommand) && hasNoOption(args, GIT_UNSAFE_OPTIONS)
}

function isReadingStage(stage: string, checks: Record<string, ArgumentCheck>): boolean {
  const command = simpleCommandOf(stage)
  const [name, ...args] = shellWords(command).map(({ word }) => word)
  if (name === 'git') return isGitRead(command)
  return Object.hasOwn(checks, name ?? '') && checks[name](args)
}

/** Whether every substitution in the step reads. One the parser can't account for (nested, say) counts as not reading. */
function substitutionsOnlyRead(step: string): boolean {
  if (!containsCommandSubstitution(step)) return true
  if (PROCESS_SUBSTITUTION.test(maskQuotedText(step))) return false
  const literalMasked = maskLiteralText(step)
  const commands = substitutionCommands(literalMasked)
  const openers = literalMasked.split('$(').length - 1 + Math.ceil((literalMasked.split('`').length - 1) / 2)
  return commands.length === openers && commands.every(isReadOnlyCommand)
}

function isReadOnlyStep(step: string): boolean {
  if (!substitutionsOnlyRead(step)) return false
  const [firstStage = '', ...laterStages] = splitOutsideQuotes(step, PIPE_SEPARATORS)
  return (
    isReadingStage(firstStage, READERS) &&
    laterStages.every((stage) => isReadingStage(stage, { ...READERS, ...PIPE_FILTERS }))
  )
}

function writesToFile(step: string): boolean {
  return [...maskQuotedText(step).matchAll(OUTPUT_REDIRECTION)].some(([, target]) => !HARMLESS_TARGET.test(target))
}

/** Whether a whole captured command only reads: it runs something, and everything it runs is on the list. */
export function isReadOnlyCommand(command: string): boolean {
  const steps = commandSteps(command)
  if (steps.some(writesToFile)) return false
  const workSteps = steps.filter((step) => !isGlueStep(step))
  return workSteps.length > 0 && workSteps.every(isReadOnlyStep)
}

/** What's stored for a read-only command, from the first step that does anything. */
export function readOnlyMetadata(command: string): Record<string, unknown> {
  const firstWorkStep = commandSteps(command).find((step) => !isGlueStep(step)) ?? ''
  const [firstStage = ''] = splitOutsideQuotes(firstWorkStep, PIPE_SEPARATORS)
  const simple = simpleCommandOf(firstStage)
  const invocation = parseGitInvocation(simple)
  return invocation ? { subcommand: invocation.subcommand } : { tool: shellWords(simple)[0]?.word ?? null }
}
