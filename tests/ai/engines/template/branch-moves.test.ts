import { describe, it, expect } from 'vitest'
import { describeBranchMoves, describeEventMoves } from '../../../../src/ai/engines/template/branch-moves'
import { storyLines } from '../../../../src/ai/engines/template/story'
import { gitMovesOf } from '../../../../src/normalize/git-move'
import { event, onBranch, session } from './fixtures'
import type { EventPayload } from '../../../../src/ai/types'

/** A git command as capture stores it: on the branch it ended on, with the moves the payload reads from it. */
function git(command: string, branch: string | null): EventPayload {
  return { ...onBranch(branch, event('versioning')), gitMoves: gitMovesOf(command) }
}

describe('describeBranchMoves', () => {
  it('says which branch a new branch was created from', () => {
    const events = [onBranch('main', event('testing')), git('git switch -c feat/x', 'feat/x')]

    expect(describeBranchMoves(events)).toEqual([{ branch: 'feat/x', line: 'Created feat/x from main' }])
  })

  it('just names a new branch when what it came from is unknown', () => {
    expect(describeBranchMoves([git('git checkout -b feat/x', 'feat/x')])).toEqual([
      { branch: 'feat/x', line: 'Created feat/x' },
    ])
  })

  it('reads a stash popped on another branch as uncommitted changes moved between them', () => {
    const events = [git('git stash', 'main'), git('git switch feat/x', 'feat/x'), git('git stash pop', 'feat/x')]

    expect(describeBranchMoves(events)).toEqual([
      { branch: 'feat/x', line: 'Moved uncommitted changes from main to feat/x (git stash, then git stash pop)' },
    ])
  })

  it('follows a compound command step by step', () => {
    const events = [
      onBranch('main', event('testing')),
      git('git stash && git switch -c feat/x && git stash apply', 'feat/x'),
    ]

    expect(describeBranchMoves(events)).toEqual([
      { branch: 'feat/x', line: 'Created feat/x from main' },
      { branch: 'feat/x', line: 'Moved uncommitted changes from main to feat/x (git stash, then git stash apply)' },
    ])
  })

  it('reads a stash restored on the same branch as changes set aside', () => {
    expect(describeBranchMoves([git('git stash', 'main'), git('git stash pop', 'main')])).toEqual([
      { branch: 'main', line: 'Set changes aside and restored them (git stash, then git stash pop)' },
    ])
  })

  it('says when changes were left stashed, and when a stash from earlier was restored', () => {
    expect(describeBranchMoves([git('git stash -u', 'main')])).toEqual([
      { branch: 'main', line: 'Left changes stashed (git stash)' },
    ])
    expect(describeBranchMoves([git('git stash pop', 'feat/x')])).toEqual([
      { branch: 'feat/x', line: 'Restored stashed changes (git stash pop)' },
    ])
  })

  it('says what was rebased onto what, and merged into what', () => {
    expect(describeBranchMoves([git('git rebase -i main', 'feat/x'), git('git merge feat/y', 'feat/x')])).toEqual([
      { branch: 'feat/x', line: 'Rebased feat/x onto main' },
      { branch: 'feat/x', line: 'Merged feat/y into feat/x' },
    ])
  })

  it.each([
    ['git reset --hard', 'Discarded local changes (git reset --hard)'],
    ['git checkout -- src/auth.ts', 'Discarded changes to files (git checkout -- …)'],
    ['git restore src/auth.ts', 'Discarded changes to files (git restore)'],
    ['git clean -fd', 'Deleted untracked files (git clean)'],
  ])('flags %s plainly, since it is the move people most need to retrace', (command, line) => {
    expect(describeBranchMoves([git(command, 'main')])).toEqual([{ branch: 'main', line }])
  })

  it('reads `git checkout <file>` (no `--`) as a discard, since the branch did not change', () => {
    const events = [onBranch('main', event('testing')), git('git checkout src/auth.ts', 'main')]

    expect(describeBranchMoves(events)).toEqual([
      { branch: 'main', line: 'Discarded changes to files (git checkout -- …)' },
    ])
  })

  it('reads no discard from checkouts on a detached HEAD, such as a tag or a manual bisect', () => {
    const events = [
      git('git checkout v1.2.3', null),
      git('git checkout abc1234', null),
      git('git checkout def5678', null),
    ]

    expect(describeBranchMoves(events)).toEqual([])
  })

  it("doesn't follow a file checkout as a branch inside a compound command", () => {
    const events = [git('git stash', 'main'), git('git checkout src/auth.ts && git stash pop', 'main')]

    expect(describeBranchMoves(events)).toEqual([
      { branch: 'main', line: 'Discarded changes to files (git checkout -- …)' },
      { branch: 'main', line: 'Set changes aside and restored them (git stash, then git stash pop)' },
    ])
  })

  it("doesn't read a branch round-trip in one command as a discard", () => {
    const events = [
      onBranch('feat/x', event('testing')),
      git('git checkout main && git pull && git checkout feat/x && git rebase main', 'feat/x'),
    ]

    expect(describeBranchMoves(events)).toEqual([{ branch: 'feat/x', line: 'Rebased feat/x onto main' }])
  })

  it('follows `git checkout -` back to the branch before, so a stash round-trip reads as one', () => {
    const events = [
      onBranch('feat/x', event('testing')),
      git('git stash && git checkout main && git pull && git checkout - && git stash pop', 'feat/x'),
    ]

    expect(describeBranchMoves(events)).toEqual([
      { branch: 'feat/x', line: 'Set changes aside and restored them (git stash, then git stash pop)' },
    ])
  })

  it('tells a move repeated on one branch each time it happened', () => {
    const events = [
      git('git reset --hard', 'main'),
      onBranch('main', event('testing')),
      git('git reset --hard', 'main'),
    ]

    expect(storyLines(session(events, { branches: ['main'] }))).toEqual([
      '- Tests passing',
      '- Discarded local changes (git reset --hard)',
      '- Discarded local changes (git reset --hard)',
    ])
  })

  it('keeps an applied stash out of "left stashed": you used it, though it stays in git stash list', () => {
    expect(describeBranchMoves([git('git stash', 'main'), git('git stash apply', 'main')])).toEqual([
      { branch: 'main', line: 'Set changes aside and restored them (git stash, then git stash apply)' },
    ])
  })

  it('flags a dropped stash, and no longer reports it as left', () => {
    expect(describeBranchMoves([git('git stash', 'main'), git('git stash drop', 'main')])).toEqual([
      { branch: 'main', line: 'Dropped stashed changes (git stash drop)' },
    ])
    expect(
      describeBranchMoves([git('git stash', 'main'), git('git stash', 'main'), git('git stash clear', 'main')])
    ).toEqual([{ branch: 'main', line: 'Dropped all stashed changes (git stash clear)' }])
  })

  it('gives a plain switch no line: the story says it with "On <branch>:"', () => {
    expect(describeBranchMoves([git('git switch main', 'main')])).toEqual([])
  })
})

describe('storyLines — branch moves', () => {
  it('tells each move under its branch, after the work', () => {
    const events = [
      onBranch('main', event('testing')),
      git('git stash', 'main'),
      git('git switch -c feat/x', 'feat/x'),
      git('git stash pop', 'feat/x'),
      onBranch('feat/x', event('building')),
    ]

    expect(storyLines(session(events, { branches: ['main', 'feat/x'] }))).toEqual([
      'On main:',
      '- Tests passing',
      'On feat/x:',
      '- Build passing',
      '- Created feat/x from main',
      '- Moved uncommitted changes from main to feat/x (git stash, then git stash pop)',
    ])
  })

  it('turns a session that only moved branches into a story, not an "explored" line', () => {
    expect(storyLines(session([git('git reset --hard', 'feature/auth')]))).toEqual([
      '- Discarded local changes (git reset --hard)',
    ])
  })
})

describe('describeEventMoves', () => {
  it('tells each event its own moves, and keeps stashes nobody restored apart', () => {
    const events = [
      onBranch('main', event('testing')),
      git('git stash && git switch -c feat/x', 'feat/x'),
      git('git reset --hard', 'feat/x'),
    ]

    expect(describeEventMoves(events)).toEqual({
      perEvent: [
        [],
        [{ branch: 'feat/x', line: 'Created feat/x from main' }],
        [{ branch: 'feat/x', line: 'Discarded local changes (git reset --hard)' }],
      ],
      leftStashed: [{ branch: 'main', line: 'Left changes stashed (git stash)' }],
    })
  })

  it('flattens to the same lines as describeBranchMoves', () => {
    const events = [git('git stash', 'main'), git('git switch feat/x', 'feat/x'), git('git stash pop', 'feat/x')]
    const { perEvent, leftStashed } = describeEventMoves(events)

    expect([...perEvent.flat(), ...leftStashed]).toEqual(describeBranchMoves(events))
  })
})
