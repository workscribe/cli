import { describe, it, expect } from 'vitest'
import { formatRepoName, parseOwnerAndRepo } from '../../src/capture/repo-name'

const REMOTE = { owner: 'acme', repo: 'api' }

describe('parseOwnerAndRepo', () => {
  it.each([
    ['git@github.com:acme/api.git', REMOTE],
    ['https://github.com/acme/api.git', REMOTE],
    ['ssh://git@github.com/acme/api', REMOTE],
    ['api', null],
  ])('%s', (url, expected) => {
    expect(parseOwnerAndRepo(url)).toEqual(expected)
  })
})

describe('formatRepoName', () => {
  it('is owner/repo when qualified, bare repo otherwise', () => {
    expect(formatRepoName(REMOTE, true)).toBe('acme/api')
    expect(formatRepoName(REMOTE, false)).toBe('api')
  })
})
