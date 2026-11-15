import { describe, it, expect } from 'vitest'
import { recoveryPointersOf } from '../../src/summary/recovery'
import { gitMovesOf } from '../../src/normalize/git-move'

const pointers = (command: string) => recoveryPointersOf(gitMovesOf(command))

describe('recoveryPointersOf', () => {
  it('sends a hard reset to the reflog, and says uncommitted changes are not in it', () => {
    expect(pointers('git reset --hard HEAD~1')).toEqual([
      expect.stringMatching(/git reflog.*uncommitted changes are not in it/),
    ])
  })

  it('sends a rebase to ORIG_HEAD and the reflog', () => {
    expect(pointers('git rebase main')).toEqual([
      expect.stringContaining('ORIG_HEAD'),
      expect.stringContaining('git reflog'),
    ])
  })

  it('sends a merge to ORIG_HEAD and the reflog', () => {
    expect(pointers('git merge feat/y')).toHaveLength(2)
  })

  it('points a stash and an applied stash at git stash list', () => {
    expect(pointers('git stash')).toEqual([expect.stringContaining('git stash list')])
    expect(pointers('git stash apply')).toEqual([expect.stringContaining('git stash list')])
  })

  it('points a dropped stash at fsck, since it has left the list', () => {
    expect(pointers('git stash drop')).toEqual([expect.stringContaining('git fsck --unreachable')])
    expect(pointers('git stash clear')).toEqual([expect.stringContaining('git fsck --unreachable')])
  })

  it.each(['git stash pop', 'git checkout -- a.ts', 'git restore a.ts', 'git clean -fd', 'git switch main'])(
    'gives %s no pointer, since git keeps no record to point to',
    (command) => {
      expect(pointers(command)).toEqual([])
    }
  )

  it('names each pointer once for a compound command', () => {
    expect(pointers('git stash && git stash')).toHaveLength(1)
  })
})
