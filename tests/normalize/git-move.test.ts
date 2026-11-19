import { describe, it, expect } from 'vitest'
import { gitMovesOf } from '../../src/normalize/git-move'
import { redact } from '../../src/capture/redact'

describe('gitMovesOf — branches', () => {
  it.each([
    ['git checkout -b feat/x', 'feat/x'],
    ['git checkout -B feat/x origin/main', 'feat/x'],
    ['git switch -c feat/x', 'feat/x'],
    ['git switch --create=feat/x', 'feat/x'],
    ['git -C ~/code/api checkout -b feat/x', 'feat/x'],
    ['git checkout --track origin/feat/x', 'feat/x'],
    ['git switch -t origin/fix/typo', 'fix/typo'],
    ['git checkout --track=direct origin/feat/x', 'feat/x'],
  ])('reads %s as creating %s', (command, branch) => {
    expect(gitMovesOf(command)).toEqual([{ kind: 'create-branch', branch }])
  })

  it('reads `git checkout -` as a switch back to the branch before', () => {
    expect(gitMovesOf('git checkout -')).toEqual([{ kind: 'switch', branch: '-' }])
    expect(gitMovesOf('git switch -')).toEqual([{ kind: 'switch', branch: '-' }])
  })

  it('reads a plain switch, so a later step of the same command is placed on the right branch', () => {
    expect(gitMovesOf('git checkout main')).toEqual([{ kind: 'switch', branch: 'main' }])
    expect(gitMovesOf('git switch feat/x')).toEqual([{ kind: 'switch', branch: 'feat/x' }])
  })
})

describe('gitMovesOf — stash', () => {
  it.each(['git stash', 'git stash -u', 'git stash push -m "wip"', 'git stash save wip'])(
    'reads %s as a push',
    (command) => {
      expect(gitMovesOf(command)).toEqual([{ kind: 'stash-push' }])
    }
  )

  it('reads pop and apply, naming which', () => {
    expect(gitMovesOf('git stash pop')).toEqual([{ kind: 'stash-pop', command: 'git stash pop' }])
    expect(gitMovesOf('git stash apply stash@{1}')).toEqual([{ kind: 'stash-pop', command: 'git stash apply' }])
  })

  it('reads list and show as no move', () => {
    expect(gitMovesOf('git stash list')).toEqual([])
    expect(gitMovesOf('git stash show -p')).toEqual([])
  })

  it('reads drop and clear, which throw stashed changes away', () => {
    expect(gitMovesOf('git stash drop')).toEqual([{ kind: 'stash-drop', command: 'git stash drop' }])
    expect(gitMovesOf('git stash clear')).toEqual([{ kind: 'stash-drop', command: 'git stash clear' }])
  })

  it.each([
    'git stash -m wip',
    'git stash --message "half done"',
    'git stash -- src/auth.ts',
    'git stash push -- src/a.ts',
  ])('reads %s as a push: a message or path is not a subcommand', (command) => {
    expect(gitMovesOf(command)).toEqual([{ kind: 'stash-push' }])
  })
})

describe('gitMovesOf — rebase and merge', () => {
  it('reads what a rebase went onto, skipping flags', () => {
    expect(gitMovesOf('git rebase -i main')).toEqual([{ kind: 'rebase', onto: 'main' }])
    expect(gitMovesOf('git rebase --onto main feat/base')).toEqual([{ kind: 'rebase', onto: 'main' }])
  })

  it('reads what was merged in', () => {
    expect(gitMovesOf('git merge --no-ff feat/x')).toEqual([{ kind: 'merge', from: 'feat/x' }])
  })

  it("never reads a flag's value as the branch: a merge message stays out of the story", () => {
    expect(gitMovesOf('git merge --no-ff -m "Merge feat" feat/x')).toEqual([{ kind: 'merge', from: 'feat/x' }])
    expect(gitMovesOf('git merge -s ours -X theirs feat/x')).toEqual([{ kind: 'merge', from: 'feat/x' }])
    expect(gitMovesOf('git rebase -X theirs main')).toEqual([{ kind: 'rebase', onto: 'main' }])
    expect(gitMovesOf('git rebase --exec "npm test" main')).toEqual([{ kind: 'rebase', onto: 'main' }])
  })

  it.each(['git rebase --continue', 'git rebase --abort', 'git merge --abort', 'git rebase'])(
    'reads %s as no move',
    (command) => {
      expect(gitMovesOf(command)).toEqual([])
    }
  )
})

describe('gitMovesOf — discarding changes', () => {
  it.each([
    ['git reset --hard', 'git reset --hard'],
    ['git reset --hard HEAD~1', 'git reset --hard'],
    ['git checkout -- src/auth.ts', 'git checkout -- …'],
    ['git checkout .', 'git checkout -- …'],
    ['git restore src/auth.ts', 'git restore'],
    ['git restore --staged --worktree src/auth.ts', 'git restore'],
    ['git clean -fd', 'git clean'],
  ])('reads %s as a discard', (command, discard) => {
    expect(gitMovesOf(command)).toEqual([{ kind: 'discard', command: discard }])
  })

  it.each(['git reset --soft HEAD~1', 'git reset src/auth.ts', 'git restore --staged src/auth.ts', 'git clean -n'])(
    'reads %s as no discard',
    (command) => {
      expect(gitMovesOf(command)).toEqual([])
    }
  )
})

describe('gitMovesOf — compound commands', () => {
  it('reads every step, in order, past cd and other glue', () => {
    expect(gitMovesOf('cd ~/code/api && git stash && git switch -c feat/x && git stash pop')).toEqual([
      { kind: 'stash-push' },
      { kind: 'create-branch', branch: 'feat/x' },
      { kind: 'stash-pop', command: 'git stash pop' },
    ])
  })

  it('finds nothing in commands that are not git', () => {
    expect(gitMovesOf('npm test && echo done')).toEqual([])
  })

  it.each([
    ['echo "use mongo -p" && git switch -c x && echo "y"', 'x'],
    [`git commit -m "don't use mongo -p" && git switch -c x && git commit -m "b"`, 'x'],
    ['curl -H "Cookie:" x && git switch -c y && echo "z"', 'y'],
    ['mysql -pFAKEVALUE;git switch -c y', 'y'],
  ])('still finds the branch move once the command is redacted: %s', (command, branch) => {
    expect(gitMovesOf(redact(command))).toContainEqual({ kind: 'create-branch', branch })
  })
})
