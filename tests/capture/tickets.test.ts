import { describe, it, expect } from 'vitest'
import { DEFAULT_TICKET_PATTERN, ticketKeysOf, ticketPatternOf, ticketPatternProblem } from '../../src/capture/tickets'

const PATTERN = ticketPatternOf(DEFAULT_TICKET_PATTERN)

function event(overrides: { category?: string; metadata?: unknown; exit_code?: number | null } = {}) {
  return {
    category: overrides.category ?? 'testing',
    metadata: overrides.metadata === undefined ? null : JSON.stringify(overrides.metadata),
    exit_code: overrides.exit_code === undefined ? 0 : overrides.exit_code,
    captured_at: '2026-10-28T12:00:00.000Z',
    branch: 'feat/WOR-123-context-file-details',
  }
}

describe('ticketKeysOf', () => {
  it("finds the ticket in the linked branch's name", () => {
    expect(ticketKeysOf({ linkedBranch: 'feat/WOR-123-context-file-details', event: event() }, PATTERN)).toEqual({
      branch: ['WOR-123'],
      commits: [],
    })
  })

  it('names no branch ticket when the event is linked to no branch, whatever its raw branch text says', () => {
    // A save in another repo keeps the open folder's branch name, without a link to it
    expect(ticketKeysOf({ linkedBranch: null, event: event() }, PATTERN).branch).toEqual([])
  })

  it('finds every ticket a commit message names, once each', () => {
    const commit = event({
      category: 'shipping',
      metadata: { message: 'WOR-123 fix the README, see WOR-9 and WOR-123' },
    })

    expect(ticketKeysOf({ linkedBranch: null, event: commit }, PATTERN).commits).toEqual(['WOR-123', 'WOR-9'])
  })

  it('names nothing for a commit that failed', () => {
    const failed = event({ category: 'shipping', metadata: { message: 'WOR-123 fix' }, exit_code: 1 })

    expect(ticketKeysOf({ linkedBranch: null, event: failed }, PATTERN).commits).toEqual([])
  })

  it("finds the tickets in an AI session's commits", () => {
    const session = event({ category: 'ai_session', metadata: { commits: ['WOR-147 list threads', 'chore: tidy'] } })

    expect(ticketKeysOf({ linkedBranch: null, event: session }, PATTERN).commits).toEqual(['WOR-147'])
  })

  it('drops a key cut short at the end of the searched start', () => {
    const subject = `${'x'.repeat(192)} WOR-1234 more`
    const commit = event({ category: 'shipping', metadata: { message: subject } })

    expect(ticketKeysOf({ linkedBranch: null, event: commit }, PATTERN).commits).toEqual([])
  })

  it('never names an empty key, even for a pattern that can match empty text inside a text', () => {
    const commit = event({ category: 'shipping', metadata: { message: 'see WOR-5' } })

    expect(ticketKeysOf({ linkedBranch: null, event: commit }, ticketPatternOf('[A-Z]*(?=-\\d)')).commits).toEqual([
      'WOR',
    ])
  })

  it('searches only the start of a long text', () => {
    const subject = `${'x'.repeat(200)} WOR-123`
    const commit = event({ category: 'shipping', metadata: { message: subject } })

    expect(ticketKeysOf({ linkedBranch: null, event: commit }, PATTERN).commits).toEqual([])
  })

  it('matches case-sensitively by default, and follows a custom pattern', () => {
    const lower = event({ category: 'shipping', metadata: { message: 'wor-123 fix, #42' } })

    expect(ticketKeysOf({ linkedBranch: null, event: lower }, PATTERN).commits).toEqual([])
    expect(ticketKeysOf({ linkedBranch: null, event: lower }, ticketPatternOf('#\\d+')).commits).toEqual(['#42'])
  })
})

describe('ticketPatternOf / ticketPatternProblem', () => {
  it.each([
    ['(', "isn't a valid regular expression"],
    ['.*', 'matches empty text'],
    ['(A+)+-\\d+', 'repeats a group that itself repeats'],
    ['((A+))+-\\d+', 'repeats a group that itself repeats'],
    ['(A|AA)+-\\d+', 'repeats a group that itself repeats or has alternatives'],
    ['(?:A*)*B', 'repeats a group'],
    ['((a)+){2}', 'repeats a group'],
  ])('refuses %s and falls back to the default for it', (source, problem) => {
    expect(ticketPatternProblem(source)).toContain(problem)
    expect(ticketPatternOf(source).source).toBe(DEFAULT_TICKET_PATTERN)
  })

  it.each([['[A-Z][A-Z0-9]+-\\d+'], ['#\\d+'], ['[A-Z]{2,}-\\d+'], ['(WOR|API)-\\d+'], ['[(+]A+'], ['\\(A+\\)+B']])(
    'accepts %s — alternatives and repeats outside a repeated group, brackets in a class or escaped, are fine',
    (source) => {
      expect(ticketPatternProblem(source)).toBeNull()
    }
  )

  it('accepts a sound pattern', () => {
    expect(ticketPatternProblem('[A-Z]+-\\d+')).toBeNull()
    expect(ticketPatternOf('[A-Z]+-\\d+').source).toBe('[A-Z]+-\\d+')
  })

  it('falls back to the default for a value that is not text, as a hand-edited config might hold', () => {
    expect(ticketPatternOf(123).source).toBe(DEFAULT_TICKET_PATTERN)
    expect(ticketPatternOf(undefined).source).toBe(DEFAULT_TICKET_PATTERN)
  })
})
