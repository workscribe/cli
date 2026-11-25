// Commands that run a script read from standard input (`python3 - <<'EOF'`, `python3 <<'EOF'`, `cat a.py | python3 -`).
// The script's body is never stored (heredoc bodies are removed before a command is), so nothing stored says what it
// does: it may have rewritten files, and it isn't a read. Pure.
import { commandSteps, simpleCommandOf } from '../capture/command-steps'
import { maskQuotedText, shellWords, splitOutsideQuotes } from '../capture/shell-syntax'

/** The interpreters whose script can come from standard input. */
const INTERPRETERS = ['python', 'python3', 'node', 'ruby', 'perl']
/** Shells that run a script from standard input too (`bash -s`); the rules file these by their own name. */
export const SCRIPT_SHELLS: ReadonlySet<string> = new Set(['bash', 'sh', 'zsh'])

const STDIN_OPERAND = '-'
const PIPE_SEPARATORS = ['|']
// A `<` that isn't `<(…)`: `< file`, `<<EOF`, `<<<text`
const INPUT_REDIRECTION = /<(?!\()/
const LONG_OPTION_WITH_VALUE = /^--[^=]+=/
// `<<< 'print(1)'`: the text fed to the command, which isn't one of its arguments
const HERE_STRING = /<<<\s*(?:'[^']*'|"[^"]*"|\S+)/g

/** The options an interpreter takes before the script: those with no value, and those followed by a value. */
interface InterpreterOptions {
  flags: RegExp
  /** `-W ignore`: the word after it is its value, not the script */
  valueOptions: ReadonlySet<string>
  /** `-Wignore`: the value attached */
  attachedValue?: RegExp
}

const PYTHON_OPTIONS: InterpreterOptions = {
  flags: /^-[uBEsSOqvIbdiPx]+$/,
  valueOptions: new Set(['-W', '-X']),
  attachedValue: /^-[WX]./,
}
const NODE_OPTIONS: InterpreterOptions = {
  flags: /^--[a-z][a-z0-9-]*$/,
  valueOptions: new Set(['-r', '--require', '--import', '--loader', '--experimental-loader']),
}
const RUBY_PERL_OPTIONS: InterpreterOptions = { flags: /^-[wWTtv]+\d*$/, valueOptions: new Set() }
const OPTIONS_OF: Record<string, InterpreterOptions> = {
  python: PYTHON_OPTIONS,
  python3: PYTHON_OPTIONS,
  node: NODE_OPTIONS,
  ruby: RUBY_PERL_OPTIONS,
  perl: RUBY_PERL_OPTIONS,
}

// `bash -x -s`, `bash -xs`: `-s` reads the script from standard input, the other letters don't take a value
const SHELL_FLAGS = /^-[exuvnf]+$/
const SHELL_STDIN_OPTION = /^-[exuvnf]*s[exuvnf]*$/

/** `python3` is told as `python`, like the rest of the rules. */
function runtimeName(name: string): string {
  return name === 'python3' ? 'python' : name
}

/** The first word of an interpreter's arguments that isn't one of its options or their values, or undefined if none. */
function firstOperandOf(args: string[], options: InterpreterOptions): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (options.valueOptions.has(arg)) index++
    else if (!isKnownFlag(arg, options)) return arg
  }
  return undefined
}

function isKnownFlag(arg: string, options: InterpreterOptions): boolean {
  return options.flags.test(arg) || LONG_OPTION_WITH_VALUE.test(arg) || (options.attachedValue?.test(arg) ?? false)
}

/** The first word of a shell's arguments that isn't a flag with no value, with the `-s` forms read as standard input. */
function shellOperandOf(args: string[]): string | undefined {
  const operand = args.find((arg) => !SHELL_FLAGS.test(arg))
  return operand !== undefined && SHELL_STDIN_OPTION.test(operand) ? STDIN_OPERAND : operand
}

/** Whether a stage feeds a file, a heredoc or a here-string to its command (quoted text and `<(…)` aside). */
function readsRedirectedInput(stage: string): boolean {
  return INPUT_REDIRECTION.test(maskQuotedText(stage))
}

/** The interpreter a stage (one command, no pipe, as written) runs a script from standard input with, or null. */
function stdinInterpreterOf(stage: string): string | null {
  const [name = '', ...args] = shellWords(simpleCommandOf(stage.replace(HERE_STRING, ''))).map(({ word }) => word)
  const isShell = SCRIPT_SHELLS.has(name)
  if (!isShell && !(name in OPTIONS_OF)) return null
  const operand = isShell ? shellOperandOf(args) : firstOperandOf(args, OPTIONS_OF[name])
  const runsStdin = operand === STDIN_OPERAND || (operand === undefined && readsRedirectedInput(stage))
  return runsStdin ? runtimeName(name) : null
}

/** Whether one command (no pipe) runs a script from standard input. */
export function runsScriptFromStdin(command: string): boolean {
  return stdinInterpreterOf(command) !== null
}

/** The interpreters a stored command runs scripts from standard input with, in every step and every stage of a pipe. */
export function stdinScriptInterpreters(command: string): string[] {
  return commandSteps(command)
    .flatMap((step) => splitOutsideQuotes(step, PIPE_SEPARATORS))
    .flatMap((stage) => stdinInterpreterOf(stage) ?? [])
}

/** How many scripts from standard input a stored command runs. */
export function stdinScriptCount(command: string): number {
  return stdinScriptInterpreters(command).length
}

const INTERPRETER_NAMES = new RegExp(`\\b(?:${[...INTERPRETERS, ...SCRIPT_SHELLS].join('|')})\\b`)

/** A cheap check before parsing: only a command naming an interpreter can run a script from standard input. */
export function mentionsStdinInterpreter(command: string): boolean {
  return INTERPRETER_NAMES.test(command)
}
