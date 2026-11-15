import { describe, it, expect } from 'vitest'
import { FAILED_EXIT_CODE } from '../../src/capture/hooks/event'
import { commitSubjectOf, exitCodeAfterCommitCheck } from '../../src/capture/commit-check'

const check = (overrides: Partial<Parameters<typeof exitCodeAfterCommitCheck>[0]> = {}) =>
  exitCodeAfterCommitCheck({
    exitCode: null,
    category: 'shipping',
    metadata: { message: 'fix: token race' },
    headSubject: 'an earlier commit',
    ...overrides,
  })

describe('commitSubjectOf', () => {
  it('is the first line of a message', () => {
    expect(commitSubjectOf('fix: token race\n\nLonger why')).toBe('fix: token race')
  })
})

describe('exitCodeAfterCommitCheck', () => {
  it('stores -1 when HEAD is not the commit the command named: it was rejected', () => {
    expect(check()).toBe(FAILED_EXIT_CODE)
  })

  it('leaves a commit that landed unknown', () => {
    expect(check({ headSubject: 'fix: token race' })).toBeNull()
  })

  it('compares the subject, not the whole message', () => {
    expect(check({ metadata: { message: 'fix: token race\n\nwhy' }, headSubject: 'fix: token race' })).toBeNull()
  })

  it.each([
    ['--amend --no-edit, with no message to compare', { metadata: {} }],
    ['an empty message', { metadata: { message: '  ' } }],
    ['git unable to say what HEAD is', { headSubject: null }],
    ['a push, which has no message', { category: 'shipping', metadata: { remote: 'origin' } }],
    ['anything that is not a shipping event', { category: 'testing' }],
  ])('leaves %s as it was', (_name, overrides) => {
    expect(check(overrides)).toBeNull()
  })

  it('never changes a code the hook did report', () => {
    expect(check({ exitCode: 0 })).toBe(0)
    expect(check({ exitCode: 1 })).toBe(1)
  })
})
