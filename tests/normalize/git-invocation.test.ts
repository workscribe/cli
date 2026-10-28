import { describe, it, expect } from 'vitest'
import { parseGitInvocation, withoutGitGlobalOptions } from '../../src/normalize/git-invocation'

describe('parseGitInvocation', () => {
  it('reads -C (quoted, repeated), --work-tree, --git-dir and skips the other global options', () => {
    const invocation = parseGitInvocation(
      'git -C "/a b" -C sub -c user.name=x --no-pager --work-tree=/w --git-dir /g/.git commit -m x'
    )
    expect(invocation).toMatchObject({
      directories: ['/a b', 'sub'],
      workTree: '/w',
      gitDir: '/g/.git',
      subcommand: 'commit',
    })
    expect(invocation?.args.map(({ word }) => word)).toEqual(['-m', 'x'])
  })

  it('is null for anything but git', () => {
    expect(parseGitInvocation('npm test')).toBeNull()
  })
})

describe('withoutGitGlobalOptions', () => {
  it.each([
    ['git -C "/a b" commit -m "x"', 'git commit -m "x"'],
    ['git -c user.name=x commit -m "y"', 'git commit -m "y"'],
    ['git --work-tree=/w --no-pager log --oneline', 'git log --oneline'],
    ['git status', 'git status'],
    ['npm test', 'npm test'],
  ])('%s → %s', (command, expected) => {
    expect(withoutGitGlobalOptions(command)).toBe(expected)
  })
})
