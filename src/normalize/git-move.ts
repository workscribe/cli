// Reads the git commands that move work between branches — creating a branch, stashing, rebasing, merging and
// discarding changes — from a stored (already redacted) command, so a summary can say what happened in plain
// language. Pure: no git calls. Reading the stored command covers past days too, with no change to capture.
import { commandSteps, simpleCommandOf } from '../capture/command-steps'
import { parseGitInvocation } from './git-invocation'

export type GitMove =
  | { kind: 'create-branch'; branch: string }
  // A plain switch tells no story of its own, but says which branch the next step of the command ran on.
  // `-` is git's "the branch you were on before" (`git checkout -`).
  | { kind: 'switch'; branch: string }
  | { kind: 'stash-push' }
  // `pop` restores the stash and removes it; `apply` restores it and keeps it in `git stash list`
  | { kind: 'stash-pop'; command: 'git stash pop' | 'git stash apply' }
  // Dropping a stash throws its changes away: `drop` the latest, `clear` all of them
  | { kind: 'stash-drop'; command: 'git stash drop' | 'git stash clear' }
  | { kind: 'rebase'; onto: string }
  | { kind: 'merge'; from: string }
  | { kind: 'discard'; command: DiscardCommand }

/** How changes were thrown away, named the way you'd look it up again. */
export type DiscardCommand = 'git reset --hard' | 'git checkout -- …' | 'git restore' | 'git clean'

// Ways out of an operation in progress — they move nothing themselves
const OPERATION_CONTROL_FLAGS = new Set(['--continue', '--abort', '--skip', '--quit'])

// Flags whose value is the next word, so it isn't read as a branch: `git merge -m "Merge feat" feat/x`
const MERGE_VALUE_FLAGS = ['-m', '-F', '--file', '-s', '--strategy', '-X', '--strategy-option']
const REBASE_VALUE_FLAGS = ['-s', '--strategy', '-X', '--strategy-option', '-x', '--exec', '--onto']
const STASH_VALUE_FLAGS = ['-m', '--message', '--pathspec-from-file']

// `git stash <word>`: anything else after `git stash` is a push with options or paths (`git stash -m wip`)
const STASH_SUBCOMMANDS = new Set([
  'push',
  'save',
  'pop',
  'apply',
  'list',
  'show',
  'drop',
  'clear',
  'branch',
  'create',
  'store',
])

/** The value after a flag (`-b feat/x`) or attached to it (`--create=feat/x`). */
function flagValue(words: string[], flags: string[]): string | null {
  for (const [index, word] of words.entries()) {
    if (flags.includes(word)) return words[index + 1] ?? null
    const attached = flags.find((flag) => flag.startsWith('--') && word.startsWith(`${flag}=`))
    if (attached) return word.slice(attached.length + 1)
  }
  return null
}

/** The words that aren't flags or a flag's value; everything after `--` is a path, not a positional. */
function positionals(words: string[], valueFlags: string[] = []): string[] {
  const found: string[] = []
  for (let index = 0; index < words.length; index++) {
    const word = words[index]
    if (word === '--') break
    if (valueFlags.includes(word)) index++
    else if (!word.startsWith('-')) found.push(word)
  }
  return found
}

function isOperationControl(words: string[]): boolean {
  return words.some((word) => OPERATION_CONTROL_FLAGS.has(word))
}

/** `--track origin/x` (or `-t`, or `--track=direct origin/x`) creates the local branch `x` tracking it. */
function trackedBranch(words: string[]): string | null {
  const isTracking = words.some((word) => word === '--track' || word === '-t' || word.startsWith('--track='))
  const [upstream] = positionals(words)
  if (!isTracking || !upstream) return null
  const slash = upstream.indexOf('/')
  return slash === -1 ? upstream : upstream.slice(slash + 1)
}

/** A branch created with one of `createFlags` (`-b`, `-c`, …) or by `--track`, or null. */
function createdBranchMove(words: string[], createFlags: string[]): GitMove | null {
  const created = flagValue(words, createFlags) ?? trackedBranch(words)
  return created && !created.startsWith('-') ? { kind: 'create-branch', branch: created } : null
}

/** `git checkout main`, or `-` for the branch before (a lone `-` isn't a flag). */
function switchTarget(words: string[]): string | undefined {
  return words.includes('-') ? '-' : positionals(words)[0]
}

/**
 * `git checkout -- file` and `git checkout .` throw away the file's changes. `git checkout main` switches — and so
 * does `git checkout src/a.ts` as far as the words go; the story tells the two apart by whether the branch changed.
 */
function checkoutMove(words: string[]): GitMove | null {
  const created = createdBranchMove(words, ['-b', '-B'])
  if (created) return created
  if (words.includes('--') || positionals(words)[0] === '.') return { kind: 'discard', command: 'git checkout -- …' }
  const target = switchTarget(words)
  return target ? { kind: 'switch', branch: target } : null
}

function switchMove(words: string[]): GitMove | null {
  const created = createdBranchMove(words, ['-c', '-C', '--create', '--force-create'])
  if (created) return created
  const target = switchTarget(words)
  return target ? { kind: 'switch', branch: target } : null
}

function stashMove(words: string[]): GitMove | null {
  const [first] = positionals(words, STASH_VALUE_FLAGS)
  const action = first && STASH_SUBCOMMANDS.has(first) ? first : 'push'
  if (action === 'push' || action === 'save') return { kind: 'stash-push' }
  if (action === 'pop' || action === 'apply') return { kind: 'stash-pop', command: `git stash ${action}` }
  if (action === 'drop' || action === 'clear') return { kind: 'stash-drop', command: `git stash ${action}` }
  return null
}

function rebaseMove(words: string[]): GitMove | null {
  if (isOperationControl(words)) return null
  const onto = flagValue(words, ['--onto']) ?? positionals(words, REBASE_VALUE_FLAGS)[0]
  return onto ? { kind: 'rebase', onto } : null
}

function mergeMove(words: string[]): GitMove | null {
  if (isOperationControl(words)) return null
  const [from] = positionals(words, MERGE_VALUE_FLAGS)
  return from ? { kind: 'merge', from } : null
}

function resetMove(words: string[]): GitMove | null {
  return words.includes('--hard') ? { kind: 'discard', command: 'git reset --hard' } : null
}

/** `git restore --staged` only unstages; anything that touches the working tree throws changes away. */
function restoreMove(words: string[]): GitMove | null {
  const isUnstageOnly =
    (words.includes('--staged') || words.includes('-S')) && !words.includes('--worktree') && !words.includes('-W')
  return isUnstageOnly ? null : { kind: 'discard', command: 'git restore' }
}

/** `git clean` deletes untracked files only when forced (`-f`, `-fd`, `--force`); a dry run deletes nothing. */
function cleanMove(words: string[]): GitMove | null {
  const isForced = words.some((word) => word === '--force' || /^-[a-zA-Z]*f/.test(word))
  const isDryRun = words.some((word) => word === '--dry-run' || /^-[a-zA-Z]*n/.test(word))
  return isForced && !isDryRun ? { kind: 'discard', command: 'git clean' } : null
}

const MOVE_READERS: Record<string, (words: string[]) => GitMove | null> = {
  checkout: checkoutMove,
  switch: switchMove,
  stash: stashMove,
  rebase: rebaseMove,
  merge: mergeMove,
  reset: resetMove,
  restore: restoreMove,
  clean: cleanMove,
}

/**
 * The branch-moving work in a command, in the order it ran: every step of a compound command is read
 * (`git stash && git switch -c feat/x && git stash pop`), with git's global options (`-C dir`) set aside.
 */
export function gitMovesOf(command: string): GitMove[] {
  return commandSteps(command).flatMap((step) => {
    const invocation = parseGitInvocation(simpleCommandOf(step))
    const readMove = invocation?.subcommand ? MOVE_READERS[invocation.subcommand] : undefined
    const move = readMove?.(invocation?.args.map((arg) => arg.word) ?? [])
    return move ? [move] : []
  })
}
