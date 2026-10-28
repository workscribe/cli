import { describe, it, expect } from 'vitest'
import { effectiveDirectory } from '../../src/normalize/git-directory'

describe('effectiveDirectory', () => {
  const at = (matchedStep: string) => effectiveDirectory({ matchedStep, cwd: '/r/api' })

  it.each([
    ['git -C /other commit -m x', '/other'],
    ['git -C "/a b" commit -m x', '/a b'],
    ['git -C .. -C web commit -m x', '/r/web'],
    ['git --work-tree=/w commit -m x', '/w'],
    ['git -C web --work-tree=other commit -m x', '/r/api/web/other'],
    ['git --git-dir=/s/repo/.git commit -m x', '/s/repo'],
    ['git -C ~/x commit -m x', '/r/api'],
    ['git --work-tree=$HOME/x commit -m x', '/r/api'],
    ['git commit -m x', '/r/api'],
    ['npm test', '/r/api'],
  ])('%s → %s', (step, expected) => {
    expect(at(step)).toBe(expected)
  })

  it("never follows a `cd` — every source's cwd is already where the shell ended up", () => {
    // The matched step is the commit; the cd before it is shell glue, already reflected in cwd
    expect(effectiveDirectory({ matchedStep: 'git commit -m y', cwd: '/r/web' })).toBe('/r/web')
  })
})
