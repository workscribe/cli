import { describe, it, expect } from 'vitest'
import {
  collectCapturedCommits,
  collectNotes,
  contractEvents,
  isSameCommit,
  mergeCommits,
} from '../../../src/summary/contract/utils'
import { capturedRow, row } from './fixtures'

describe('contractEvents', () => {
  it('drops exploring and linting by default, like the AI engines', () => {
    const rows = [capturedRow('cat README.md'), capturedRow('npx eslint .'), capturedRow('npm test')]

    expect(contractEvents(rows, []).map((event) => event.category)).toEqual(['testing'])
  })

  it('keeps a default-excluded category when includeCategories opts in', () => {
    const rows = [capturedRow('cat README.md'), capturedRow('npm test')]

    expect(contractEvents(rows, ['exploring']).map((event) => event.category)).toEqual(['exploring', 'testing'])
  })

  it('never reports notes as events, even when opted in', () => {
    const rows = [row({ category: 'note', metadata: '{"text":"paired"}' })]

    expect(contractEvents(rows, ['note'])).toEqual([])
  })
})

describe('collectNotes', () => {
  it('returns note texts in order and skips empty or malformed ones', () => {
    const rows = [
      row({ category: 'note', metadata: '{"text":"first"}' }),
      row({ category: 'note', metadata: '{not json' }),
      row({ category: 'note', metadata: '{"text":""}' }),
      capturedRow('npm test'),
      row({ category: 'note', metadata: '{"text":"second"}' }),
    ]

    expect(collectNotes(rows)).toEqual(['first', 'second'])
  })
})

describe('collectCapturedCommits', () => {
  it('collects git commit messages and AI-session commits without repeats', () => {
    const rows = [
      capturedRow('git commit -m "fix: token validation"'),
      row({
        category: 'ai_session',
        metadata: '{"tool":"claude","commits":["add refresh endpoint","fix: token validation"]}',
      }),
      capturedRow('git commit --amend'),
    ]

    expect(collectCapturedCommits(rows)).toEqual(['fix: token validation', 'add refresh endpoint'])
  })

  it('skips git commits that failed, which made no commit', () => {
    const rows = [
      capturedRow('git commit -m "rejected by hook"', { exit_code: 1 }),
      capturedRow('git commit -m "landed"', { exit_code: 0 }),
      capturedRow('git commit -m "from an AI tool"', { exit_code: null }),
    ]

    expect(collectCapturedCommits(rows)).toEqual(['landed', 'from an AI tool'])
  })
})

describe('mergeCommits', () => {
  const fromGit = [
    { hash: 'a1b2c3d', subject: 'fix: token validation' },
    { hash: 'e4f5a6b', subject: 'add refresh endpoint' },
  ]

  it('gives captured subjects the hash of the matching git commit', () => {
    expect(mergeCommits(['fix: token validation'], fromGit)).toEqual([
      { hash: 'a1b2c3d', subject: 'fix: token validation', source: 'git' },
      { hash: 'e4f5a6b', subject: 'add refresh endpoint', source: 'git' },
    ])
  })

  it('keeps captured subjects git did not see, without a hash', () => {
    expect(mergeCommits(['wip: amended away'], fromGit)).toContainEqual({
      hash: null,
      subject: 'wip: amended away',
      source: 'captured',
    })
  })

  it('drops captured subjects that git attributes only to other people', () => {
    expect(mergeCommits(['teammate feature', 'my wip'], [], ['teammate feature'])).toEqual([
      { hash: null, subject: 'my wip', source: 'captured' },
    ])
  })

  it('lists repeated git subjects separately, since they are distinct commits', () => {
    const git = [
      { hash: 'a1b2c3d', subject: 'wip' },
      { hash: 'e4f5a6b', subject: 'wip' },
    ]

    expect(mergeCommits(['wip'], git).map((commit) => commit.hash)).toEqual(['a1b2c3d', 'e4f5a6b'])
  })

  it('works with no git history', () => {
    expect(mergeCommits(['fix: one'], [])).toEqual([{ hash: null, subject: 'fix: one', source: 'captured' }])
    expect(mergeCommits([], [])).toEqual([])
  })
})

describe('isSameCommit', () => {
  it('matches identical subjects', () => {
    expect(isSameCommit('fix: token', 'fix: token')).toBe(true)
  })

  it('matches a subject an older capture cut at an inner quote', () => {
    expect(isSameCommit('fix: don', "fix: don't redirect")).toBe(true)
  })

  it('matches a subject an older capture ran on into flags', () => {
    expect(isSameCommit('wip --no-verify', 'wip')).toBe(true)
  })

  it('does not treat a short subject as any commit that starts with it', () => {
    expect(isSameCommit('fix', 'fix: something else')).toBe(false)
    expect(isSameCommit('fix: token validation', 'fix: token')).toBe(false)
  })
})
