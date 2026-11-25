// The files and folders a command that only reads looked at, for the story's Read line. Pure: it never touches the file
// system, and reads only the stored (already redacted) command. A path it can't be sure of is left out, and so is
// anything the story must never name (see DENIED_*). An option it doesn't know leaves the whole command out: a word
// after an option may be the option's value, and for a search that could be the pattern, which is never a path.
import path from 'path'
import { commandSteps, MAX_STORED_COMMAND_LENGTH, simpleCommandOf } from '../capture/command-steps'
import { containsCommandSubstitution, maskQuotedText, shellWords } from '../capture/shell-syntax'
import { parseGitInvocation } from './git-invocation'
import { isReadOnlyCommand, readSedArguments } from './read-only'

/** Where a command ran, and the repository its paths are named relative to. */
export interface ReadPathContext {
  cwd: string
  repoRoot: string
}

/** The most paths one command names: enough to tell what was read, never a listing. */
const MAX_PATHS = 20

const PARENT_SEGMENT = '..'
const GLOB_CHARACTERS = /[*?[{]/
// Words the shell expands or that aren't a path: variables, substitutions, `~`, a lone `-`, and git's pathspec magic
// (`:!lockfile`, `:(exclude).env`), which names what to leave out, not a file
const UNKNOWN_VALUE = /[$`~]|^-$|^:/
// Where a command groups or nests commands, a `cd` may not reach the steps after it
const GROUPING = /[({]/
// A stored command cut at the bound ends within this many characters of it (a trimmed end can fall just short)
const CUT_SLACK = 16
const NUMBER_OPTION = /^-\d+$/
const LONG_OPTION_WITH_VALUE = /^--[^=]+=/

// Never named, wherever they sit in a path: build output, dependencies, git's own folder, credentials folders, and
// names that hold secrets
const DENIED_FOLDERS = new Set([
  'node_modules',
  'dist',
  'build',
  'coverage',
  '.git',
  '.next',
  '__pycache__',
  '.ssh',
  '.aws',
  '.gnupg',
  '.kube',
  '.docker',
])
const DENIED_NAME = new RegExp(
  [
    '^\\.env',
    '^\\.(npmrc|netrc|pgpass|htpasswd|pypirc|boto|s3cfg|my\\.cnf)$',
    '^id_(rsa|dsa|ecdsa|ed25519)',
    '\\.(pem|key|p12|pfx|jks|keystore|asc|gpg|tfvars|tfstate)$',
    '^auth\\.json$',
    'credential|secret|token|passw|kubeconfig|service.?account|api.?key|vault.?pass',
  ].join('|'),
  'i'
)

/** The options a tool takes: single letters (bundled as `-rn`), whole options, and which of them take a value. */
interface OptionTable {
  flagLetters: string
  valueLetters: string
  flagOptions: ReadonlySet<string>
  valueOptions: ReadonlySet<string>
  /** `head -20` */
  allowsNumberOption?: boolean
  /** `tail +5`, `less +/pattern`: a word starting with `+` is an option, not a file */
  plusIsOption?: boolean
}

const NO_OPTIONS: OptionTable = { flagLetters: '', valueLetters: '', flagOptions: new Set(), valueOptions: new Set() }

const CAT_OPTIONS: OptionTable = {
  ...NO_OPTIONS,
  flagLetters: 'AbeEnstTuv',
  flagOptions: new Set([
    '--number',
    '--number-nonblank',
    '--squeeze-blank',
    '--show-all',
    '--show-ends',
    '--show-tabs',
  ]),
}
const BAT_OPTIONS: OptionTable = {
  ...NO_OPTIONS,
  flagLetters: 'pnAu',
  valueLetters: 'lr',
  flagOptions: new Set(['--plain', '--number', '--show-all']),
  valueOptions: new Set(['--language', '--line-range', '--style', '--theme', '--paging', '--color']),
}
const LESS_OPTIONS: OptionTable = { ...NO_OPTIONS, flagLetters: 'NnSXFRiqQ', plusIsOption: true }
const HEAD_TAIL_OPTIONS: OptionTable = {
  ...NO_OPTIONS,
  flagLetters: 'qvzf',
  valueLetters: 'nc',
  valueOptions: new Set(['--lines', '--bytes']),
  allowsNumberOption: true,
  plusIsOption: true,
}
const WC_OPTIONS: OptionTable = {
  ...NO_OPTIONS,
  flagLetters: 'lwcmL',
  flagOptions: new Set(['--lines', '--words', '--bytes', '--chars', '--max-line-length']),
}
// grep, rg, ag and ack: `-e` and `-f` give the pattern, so the first word after them is already a path
const SEARCH_OPTIONS: OptionTable = {
  ...NO_OPTIONS,
  flagLetters: 'rRnilLcvwxFEPHhsqoaIzZUbyuSNV',
  valueLetters: 'ABCmefgtTdDjM',
  flagOptions: new Set([
    '--recursive',
    '--ignore-case',
    '--smart-case',
    '--line-number',
    '--files-with-matches',
    '--files-without-match',
    '--count',
    '--invert-match',
    '--word-regexp',
    '--no-messages',
    '--extended-regexp',
    '--fixed-strings',
    '--perl-regexp',
    '--with-filename',
    '--no-filename',
    '--only-matching',
    '--quiet',
    '--text',
    '--hidden',
    '--no-ignore',
    '--no-heading',
    '--heading',
    '--files',
  ]),
  valueOptions: new Set([
    '--regexp',
    '--file',
    '--after-context',
    '--before-context',
    '--context',
    '--max-count',
    '--glob',
    '--type',
    '--type-not',
    '--include',
    '--exclude',
    '--exclude-dir',
    '--max-depth',
    '--threads',
    '--max-columns',
    '--replace',
  ]),
}
const LS_OPTIONS: OptionTable = {
  ...NO_OPTIONS,
  flagLetters: 'laAhRtrSdFi1CGLpsx',
  valueLetters: 'I',
  flagOptions: new Set(['--all', '--almost-all', '--human-readable', '--recursive', '--directory', '--classify']),
  valueOptions: new Set(['--ignore', '--sort', '--time']),
}
const TREE_OPTIONS: OptionTable = {
  ...NO_OPTIONS,
  flagLetters: 'adfCFniqsh',
  valueLetters: 'LIP',
  valueOptions: new Set(['--charset', '--filelimit']),
}
const DU_OPTIONS: OptionTable = {
  ...NO_OPTIONS,
  flagLetters: 'ahkmsxcL',
  valueLetters: 'dBt',
  valueOptions: new Set(['--max-depth', '--block-size', '--threshold']),
}

const PATTERN_OPTION = /^--(regexp|file)(=|$)|^-[A-Za-z]*[ef]/
const FIND_EXPRESSION_START = /^[-(!]/
const HISTORY_READS = new Set(['diff', 'show', 'log'])

/** How many words after a short-option bundle (`-rn`, `-A3`, `-m 5`) it takes as values, or null when a letter is unknown. */
function valueWordsOfBundle(letters: string, table: OptionTable): number | null {
  for (const [position, letter] of [...letters].entries()) {
    if (table.flagLetters.includes(letter)) continue
    if (!table.valueLetters.includes(letter)) return null
    return position === letters.length - 1 ? 1 : 0
  }
  return 0
}

/** How many words after this option are its value, or null when the table doesn't know the option. */
function valueWordsOf(option: string, table: OptionTable): number | null {
  if (option.startsWith('--')) {
    if (LONG_OPTION_WITH_VALUE.test(option) || table.flagOptions.has(option)) return 0
    return table.valueOptions.has(option) ? 1 : null
  }
  if (NUMBER_OPTION.test(option) && table.allowsNumberOption === true) return 0
  return valueWordsOfBundle(option.slice(1), table)
}

/** The words that aren't options or their values, or null when an option isn't one the table knows. */
function operandsOf(args: string[], table: OptionTable): string[] | null {
  const operands: string[] = []
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--') return [...operands, ...args.slice(index + 1)]
    if (arg === '-' || (table.plusIsOption === true && arg.startsWith('+'))) continue
    if (!arg.startsWith('-')) {
      operands.push(arg)
      continue
    }
    const valueWords = valueWordsOf(arg, table)
    if (valueWords === null) return null
    index += valueWords
  }
  return operands
}

/** The words of a grep, rg or ag command line after its pattern — or all of them when `-e` or `-f` gave the pattern. */
function searchTargetsOf(args: string[]): string[] | null {
  const operands = operandsOf(args, SEARCH_OPTIONS)
  if (operands === null) return null
  const separator = args.indexOf('--')
  const options = separator === -1 ? args : args.slice(0, separator)
  return options.some((arg) => PATTERN_OPTION.test(arg)) ? operands : operands.slice(1)
}

/** The words of a find command line before its first expression: the places it looks in. */
function findStartsOf(args: string[]): string[] {
  const firstExpression = args.findIndex((arg) => FIND_EXPRESSION_START.test(arg))
  const starts = firstExpression === -1 ? args : args.slice(0, firstExpression)
  return starts.filter((arg) => !arg.startsWith('-'))
}

function sedFilesOf(args: string[]): string[] {
  const { scripts, positional } = readSedArguments(args)
  return scripts.length > 0 ? positional : positional.slice(1)
}

type Extractor = (args: string[]) => string[] | null

const withOptions =
  (table: OptionTable): Extractor =>
  (args) =>
    operandsOf(args, table)

/** The path words each tool that reads files names, or null when an option makes them unreadable. */
const EXTRACTORS = new Map<string, Extractor>([
  ['cat', withOptions(CAT_OPTIONS)],
  ['wc', withOptions(WC_OPTIONS)],
  ['less', withOptions(LESS_OPTIONS)],
  ['more', withOptions(LESS_OPTIONS)],
  ['head', withOptions(HEAD_TAIL_OPTIONS)],
  ['tail', withOptions(HEAD_TAIL_OPTIONS)],
  ['bat', withOptions(BAT_OPTIONS)],
  ['ls', withOptions(LS_OPTIONS)],
  ['tree', withOptions(TREE_OPTIONS)],
  ['du', withOptions(DU_OPTIONS)],
  ['grep', searchTargetsOf],
  ['egrep', searchTargetsOf],
  ['fgrep', searchTargetsOf],
  ['rg', searchTargetsOf],
  ['ripgrep', searchTargetsOf],
  ['ag', searchTargetsOf],
  ['ack', searchTargetsOf],
  ['sed', sedFilesOf],
  ['find', findStartsOf],
])

/** The paths after `--` in `git diff|show|log … -- <paths>`, and the folders `-C` moved the command to. */
function gitPathsOf(command: string): { directories: string[]; paths: string[] } | null {
  const invocation = parseGitInvocation(command)
  if (!invocation?.subcommand || !HISTORY_READS.has(invocation.subcommand)) return null
  const words = invocation.args.map(({ word }) => word)
  const separator = words.indexOf('--')
  return { directories: invocation.directories, paths: separator === -1 ? [] : words.slice(separator + 1) }
}

/** The words a single simple command names as the places it reads, and the folders git was pointed at first. */
function operandPathsOf(command: string): { directories: string[]; paths: string[] } {
  const [name = '', ...args] = shellWords(command).map(({ word }) => word)
  if (name === 'git') return gitPathsOf(command) ?? { directories: [], paths: [] }
  return { directories: [], paths: EXTRACTORS.get(name)?.(args) ?? [] }
}

/** The path up to the first segment holding a glob pattern, or null when nothing is left of it. */
function withoutGlob(word: string): string | null {
  const segments = word.split('/')
  const globAt = segments.findIndex((segment) => GLOB_CHARACTERS.test(segment))
  if (globAt === -1) return word
  const kept = segments.slice(0, globAt).join('/')
  return kept === '' || kept === '/' ? null : kept
}

function isDenied(relativePath: string): boolean {
  return relativePath
    .split('/')
    .some((segment) => DENIED_FOLDERS.has(segment.toLowerCase()) || DENIED_NAME.test(segment))
}

/** The path relative to the repository, or null when it is outside it, is the repository itself, or is never named. */
function repoRelative(word: string, folder: string | null, repoRoot: string): string | null {
  const unglobbed = withoutGlob(word)
  if (unglobbed === null || UNKNOWN_VALUE.test(unglobbed)) return null
  if (folder === null && !path.isAbsolute(unglobbed)) return null
  const relative = path.relative(repoRoot, path.resolve(folder ?? repoRoot, unglobbed))
  const isOutside =
    relative === '' || relative === PARENT_SEGMENT || relative.startsWith(`${PARENT_SEGMENT}${path.sep}`)
  if (isOutside || path.isAbsolute(relative)) return null
  const portable = relative.split(path.sep).join('/')
  return isDenied(portable) ? null : portable
}

/** The folder after a `cd` step: null when where it went can't be known (`cd $DIR`, `cd -`, `cd ~`). */
function folderAfterCd(folder: string | null, cdArguments: string[]): string | null {
  // `cd -P dir` and `cd -- dir`: the options aren't the folder
  const target = cdArguments.find((word) => word === '-' || !word.startsWith('-'))
  if (target === undefined || folder === null || UNKNOWN_VALUE.test(target)) return null
  return path.resolve(folder, target)
}

/** The repository-relative paths one simple command read, from the folder the earlier steps left it in. */
function pathsOfStep(simple: string, folder: string | null, repoRoot: string): string[] {
  const { directories, paths } = operandPathsOf(simple)
  const base = directories.reduce<string | null>((current, directory) => folderAfterCd(current, [directory]), folder)
  return paths.flatMap((word) => repoRelative(word, base, repoRoot) ?? [])
}

/**
 * The files and folders a read-only command looked at, relative to the repository and each named once, at most
 * `MAX_PATHS`. Nothing for a command that writes, or that the read-only list can't vouch for.
 */
export function readPathsOf(command: string, { cwd, repoRoot }: ReadPathContext): string[] {
  if (!isReadOnlyCommand(command)) return []
  let folder: string | null = cwd
  const found: string[] = []
  const isGrouped = GROUPING.test(maskQuotedText(command))
  for (const step of commandSteps(command)) {
    const simple = simpleCommandOf(step)
    // What a substitution expands to isn't in the command, and its words don't split the way the shell's do
    if (containsCommandSubstitution(simple)) continue
    const [name, ...cdArguments] = shellWords(simple).map(({ word }) => word)
    if (name === 'cd') folder = isGrouped ? null : folderAfterCd(folder, cdArguments)
    else found.push(...pathsOfStep(simple, folder, repoRoot))
  }
  // The stored command is cut at a bound: its last word may be a path cut short
  const complete = command.length >= MAX_STORED_COMMAND_LENGTH - CUT_SLACK ? found.slice(0, -1) : found
  return [...new Set(complete)].slice(0, MAX_PATHS)
}
