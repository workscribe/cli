// Reads `git [global options] <subcommand> …` — git's own options (`-C <dir>`, `-c k=v`, `--work-tree=…`) apart from
// the subcommand — so the rules see the subcommand. Pure: no file system or git calls.
import { type ShellWord, shellWords } from '../capture/shell-syntax'

export interface GitInvocation {
  /** `-C` directories, in order — each relative to the previous one */
  directories: string[]
  workTree: string | null
  gitDir: string | null
  /** The subcommand (`commit`, `push`, …), or null for a bare `git` or one with only options */
  subcommand: string | null
  /** The words after the subcommand */
  args: ShellWord[]
  /** Where the subcommand starts in the text, so the original (quotes and all) can be kept from there */
  subcommandStart: number
}

// Global options that take the next word as their value
const OPTIONS_WITH_VALUE = new Set([
  '-C',
  '-c',
  '--git-dir',
  '--work-tree',
  '--namespace',
  '--exec-path',
  '--config-env',
])

/** Reads `git [global options] <subcommand> …`, or null if the text isn't a git command. */
export function parseGitInvocation(command: string): GitInvocation | null {
  const words = shellWords(command.trim())
  if (words[0]?.word !== 'git') return null

  const invocation: GitInvocation = {
    directories: [],
    workTree: null,
    gitDir: null,
    subcommand: null,
    args: [],
    subcommandStart: -1,
  }
  for (let index = 1; index < words.length; index++) {
    const { word } = words[index]
    if (!word.startsWith('-')) {
      invocation.subcommand = word
      invocation.subcommandStart = words[index].start
      invocation.args = words.slice(index + 1)
      return invocation
    }
    const [name, inlineValue] = word.startsWith('--') ? splitLongOption(word) : [word, undefined]
    const takesValue = OPTIONS_WITH_VALUE.has(name)
    const value = inlineValue ?? (takesValue ? words[++index]?.word : undefined)
    if (name === '-C' && value !== undefined) invocation.directories.push(value)
    if (name === '--work-tree' && value !== undefined) invocation.workTree = value
    if (name === '--git-dir' && value !== undefined) invocation.gitDir = value
  }
  return invocation
}

function splitLongOption(word: string): [string, string | undefined] {
  const equals = word.indexOf('=')
  return equals === -1 ? [word, undefined] : [word.slice(0, equals), word.slice(equals + 1)]
}

/**
 * `git -C "/a b" -c x=y commit -m "…"` as `git commit -m "…"`: the global options dropped, the rest kept as typed —
 * so every git rule matches on the subcommand. Anything that isn't a git command comes back unchanged.
 */
export function withoutGitGlobalOptions(command: string): string {
  const invocation = parseGitInvocation(command)
  if (!invocation || invocation.subcommandStart === -1) return command
  const trimmed = command.trim()
  return `git ${trimmed.slice(invocation.subcommandStart)}`
}
