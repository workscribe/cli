// Where to look to get back what a git move changed — git's own tools only, never an invented undo command, and
// nothing for moves git keeps no record of (`checkout -- file`, `restore`, `clean`). Pure.
import type { GitMove } from '../normalize/git-move'

const REFLOG = 'git reflog lists where HEAD was before (committed work only: uncommitted changes are not in it)'
const REFLOG_COMMITS = 'git reflog lists where HEAD was before'
const ORIG_HEAD = 'ORIG_HEAD is where HEAD was before (git reset --hard ORIG_HEAD goes back to it)'
const STASH_LIST = 'git stash list shows the stash'
const FSCK = 'git fsck --unreachable can still find the dropped stash until git cleans up'

function pointersOf(move: GitMove): string[] {
  switch (move.kind) {
    case 'discard':
      return move.command === 'git reset --hard' ? [REFLOG] : []
    case 'rebase':
    case 'merge':
      return [ORIG_HEAD, REFLOG_COMMITS]
    case 'stash-push':
      return [STASH_LIST]
    case 'stash-pop':
      // A popped stash is back in the working tree; an applied one is also still in the list
      return move.command === 'git stash apply' ? [STASH_LIST] : []
    case 'stash-drop':
      return [FSCK]
    default:
      return []
  }
}

/** The recovery pointers for a command's moves, in order, each once. */
export function recoveryPointersOf(moves: GitMove[]): string[] {
  return [...new Set(moves.flatMap(pointersOf))]
}
