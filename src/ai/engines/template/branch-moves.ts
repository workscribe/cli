// A session's branch-moving git work, in plain language — so you can retrace what you did, or undo it, without
// remembering the commands. Pure: it reads the moves `eventRowToPayload` found in each event's command.
import type { EventPayload } from '../../types'
import type { DiscardCommand, GitMove } from '../../../normalize/git-move'

/** A line of the story, and the branch it tells under. */
export interface BranchMoveLine {
  branch: string | null
  line: string
}

interface PendingStash {
  branch: string | null
  /** Restored with `git stash apply`, which keeps it in `git stash list` */
  isApplied: boolean
}

const DISCARD_LINES: Record<DiscardCommand, string> = {
  'git reset --hard': 'Discarded local changes (git reset --hard)',
  'git checkout -- …': 'Discarded changes to files (git checkout -- …)',
  'git restore': 'Discarded changes to files (git restore)',
  'git clean': 'Deleted untracked files (git clean)',
}

function describeStashRestore(stash: PendingStash | undefined, branch: string | null, command: string): string {
  if (!stash) return `Restored stashed changes (${command})`
  if (stash.branch !== null && branch !== null && stash.branch !== branch) {
    return `Moved uncommitted changes from ${stash.branch} to ${branch} (git stash, then ${command})`
  }
  return `Set changes aside and restored them (git stash, then ${command})`
}

const isBranchMove = (move: GitMove): move is Extract<GitMove, { kind: 'create-branch' | 'switch' }> =>
  move.kind === 'create-branch' || move.kind === 'switch'

/**
 * Whether the event's one branch move was really `git checkout <file>`: it reads like a switch, but the command
 * left the branch as it was. A command with several branch moves (`git checkout main && git pull && git checkout
 * feat/x`) can come back to where it started without having discarded anything, so it's followed step by step.
 */
function isFileCheckout(event: EventPayload, previousBranch: string | null): boolean {
  const branchMoves = (event.gitMoves ?? []).filter(isBranchMove)
  const [only] = branchMoves
  return (
    branchMoves.length === 1 &&
    only.kind === 'switch' &&
    only.branch !== '-' &&
    // On a detached HEAD (`git checkout v1.2.3`, a manual bisect) there's no branch to compare, so it's no discard
    event.branch !== null &&
    event.branch === previousBranch &&
    only.branch !== event.branch
  )
}

/**
 * The branch each of an event's moves ran on. The event records the branch after the whole command ran, which is
 * right for a single git command; a compound one that switches part-way (`git stash && git switch -c feat/x &&
 * git stash pop`) is followed step by step from the branch before it, `git checkout -` included.
 */
function branchesDuring(event: EventPayload, previousBranch: string | null): (string | null)[] {
  const moves = event.gitMoves ?? []
  if (!moves.some(isBranchMove) || isFileCheckout(event, previousBranch)) return moves.map(() => event.branch)
  let current = previousBranch ?? event.branch
  let before: string | null = null
  return moves.map((move) => {
    if (isBranchMove(move)) {
      // `git checkout -` with no switch before it in the command goes where the command ended up
      const target = move.branch === '-' ? (before ?? event.branch) : move.branch
      before = current
      current = target
    }
    return current
  })
}

interface MoveContext {
  move: GitMove
  /** The branch the move ran on */
  branch: string | null
  /** The branch before it: what a new branch was created from */
  fromBranch: string | null
  /** The event's one branch move was really `git checkout <file>` */
  wasFileCheckout: boolean
}

/** A move that isn't about the stash, as a line — or null for one that needs none. */
function describeMove({ move, branch, fromBranch, wasFileCheckout }: MoveContext): BranchMoveLine | null {
  switch (move.kind) {
    case 'create-branch': {
      const from = fromBranch !== null && fromBranch !== move.branch ? ` from ${fromBranch}` : ''
      return { branch: move.branch, line: `Created ${move.branch}${from}` }
    }
    case 'switch':
      return wasFileCheckout ? { branch, line: DISCARD_LINES['git checkout -- …'] } : null
    case 'rebase': {
      const rebased = branch === null ? 'Rebased' : `Rebased ${branch}`
      return { branch, line: `${rebased} onto ${move.onto}` }
    }
    case 'merge': {
      const into = branch === null ? '' : ` into ${branch}`
      return { branch, line: `Merged ${move.from}${into}` }
    }
    case 'discard':
      return { branch, line: DISCARD_LINES[move.command] }
    default:
      return null
  }
}

interface StashStep {
  stashes: PendingStash[]
  line: BranchMoveLine | null
}

/**
 * One stash move against the stashes still waiting: a push adds one, a pop restores and removes the latest, an
 * apply restores it and keeps it, a drop throws the latest away and a clear all of them. Pure: returns new state.
 */
function applyStashMove(stashes: PendingStash[], move: GitMove, branch: string | null): StashStep {
  const latest = stashes.at(-1)
  switch (move.kind) {
    case 'stash-push':
      return { stashes: [...stashes, { branch, isApplied: false }], line: null }
    case 'stash-pop': {
      const line = { branch, line: describeStashRestore(latest, branch, move.command) }
      if (move.command === 'git stash pop') return { stashes: stashes.slice(0, -1), line }
      return { stashes: stashes.map((stash) => (stash === latest ? { ...stash, isApplied: true } : stash)), line }
    }
    case 'stash-drop': {
      const isClear = move.command === 'git stash clear'
      const line = { branch, line: `Dropped ${isClear ? 'all ' : ''}stashed changes (${move.command})` }
      return { stashes: isClear ? [] : stashes.slice(0, -1), line }
    }
    default:
      return { stashes, line: null }
  }
}

/**
 * Every branch move in the session, in order, each under the branch it happened on: a stash restored on another
 * branch reads as uncommitted changes moved between them, and a new branch says what it was created from (the
 * branch you were on before). A plain switch gets no line — the story's `On <branch>:` lines already say it.
 */
export function describeBranchMoves(events: EventPayload[]): BranchMoveLine[] {
  const lines: BranchMoveLine[] = []
  let stashes: PendingStash[] = []
  let previousBranch: string | null = null
  for (const event of events) {
    const branches = branchesDuring(event, previousBranch)
    const wasFileCheckout = isFileCheckout(event, previousBranch)
    for (const [index, move] of (event.gitMoves ?? []).entries()) {
      const fromBranch = index === 0 ? previousBranch : branches[index - 1]
      const stashStep = applyStashMove(stashes, move, branches[index])
      stashes = stashStep.stashes
      const line = stashStep.line ?? describeMove({ move, branch: branches[index], fromBranch, wasFileCheckout })
      if (line) lines.push(line)
    }
    if (event.branch !== null) previousBranch = event.branch
  }
  // A stash nobody restored is still waiting in `git stash list`; an applied one is there too, but you used it
  const leftStashed = stashes.filter((pending) => !pending.isApplied)
  return [...lines, ...leftStashed.map((stash) => ({ branch: stash.branch, line: 'Left changes stashed (git stash)' }))]
}
