import { describe, it, expect } from 'vitest'
import {
  collectCommits,
  countIncludedEvents,
  describeActivity,
  describeOutcome,
  describePushes,
} from '../../../../src/ai/engines/template/describe'
import { TEST_WORDING } from '../../../../src/ai/engines/template/constants'
import { event, session } from './fixtures'

describe('collectCommits', () => {
  it('skips a git commit that failed, which made no commit', () => {
    const events = [event('shipping', { message: 'rejected by hook' }, 1), event('shipping', { message: 'landed' })]

    expect(collectCommits(events)).toEqual(['landed'])
  })

  it('collects git commit messages and AI-session commits in order without repeats', () => {
    const events = [
      event('shipping', { message: 'fix: token validation' }),
      event('ai_session', { tool: 'claude', commits: ['add refresh endpoint', 'fix: token validation'] }),
      event('shipping', { message: null }),
    ]

    expect(collectCommits(events)).toEqual(['fix: token validation', 'add refresh endpoint'])
  })
})

describe('describePushes', () => {
  it('skips a push that failed, which pushed nothing', () => {
    const events = [
      event('shipping', { remote: 'origin', branch: null }, 128),
      event('shipping', { remote: 'origin', branch: 'feat/x' }),
    ]

    expect(describePushes(events)).toBe('Pushed to origin/feat/x')
  })

  it('keeps a push whose exit code is unknown', () => {
    expect(describePushes([event('shipping', { remote: 'origin', branch: 'main' }, null)])).toBe(
      'Pushed to origin/main'
    )
  })

  it('is null when every push failed', () => {
    expect(describePushes([event('shipping', { remote: 'origin', branch: 'main' }, 1)])).toBeNull()
  })
})

describe('describeOutcome', () => {
  it('is null when there were no runs', () => {
    expect(describeOutcome([event('building')], TEST_WORDING)).toBeNull()
  })

  it('reports failures that were later fixed', () => {
    const runs = [event('testing', {}, 1), event('testing', {}, 1), event('testing', {}, 0)]

    expect(describeOutcome(runs, TEST_WORDING)).toBe('Resolved failing tests (3 runs, now passing)')
  })

  it('reports runs that all passed', () => {
    expect(describeOutcome([event('testing', {}, 0)], TEST_WORDING)).toBe('Tests passing (1 run)')
  })

  it('reports a last run that failed', () => {
    expect(describeOutcome([event('testing', {}, 0), event('testing', {}, 2)], TEST_WORDING)).toBe(
      'Tests still failing (2 runs)'
    )
  })

  it('counts runs with no exit code without letting them decide the outcome', () => {
    const runs = [event('testing', {}, 1), event('testing', {}, 0), event('testing', {}, null)]

    expect(describeOutcome(runs, TEST_WORDING)).toBe('Resolved failing tests (3 runs, now passing)')
  })

  it('says the tests ran when no run has an exit code', () => {
    expect(describeOutcome([event('testing', {}, null), event('testing', {}, null)], TEST_WORDING)).toBe(
      'Ran tests (2 runs)'
    )
  })
})

// The week digest's bullets — a day's own summary tells the story instead (story.test.ts)
describe('describeActivity', () => {
  it('orders bullets notes, commits, tests, builds, dependencies, releases, pushes, edits', () => {
    const events = [
      event('code_edit'),
      event('shipping', { remote: 'origin', branch: 'feature/auth' }),
      event('releasing', { tool: 'vercel' }),
      event('dependencies', { tool: 'npm', packages: ['bcrypt', 'jsonwebtoken'] }),
      event('building', {}, 0),
      event('testing', {}, 0),
      event('shipping', { message: 'fix: token validation' }),
      event('note', { text: 'blocked on staging creds' }),
    ]

    expect(describeActivity(session(events))).toEqual([
      'Note: blocked on staging creds',
      'Committed: fix: token validation',
      'Tests passing (1 run)',
      'Builds passing (1 run)',
      'Added dependencies: bcrypt, jsonwebtoken',
      'Released / deployed (vercel)',
      'Pushed to origin/feature/auth',
    ])
  })

  it('caps a session at 7 bullets', () => {
    const notes = Array.from({ length: 9 }, (_unused, index) => event('note', { text: `note ${index}` }))

    expect(describeActivity(session(notes))).toHaveLength(7)
  })

  it('folds commits beyond the third into the third bullet', () => {
    const commits = ['one', 'two', 'three', 'four', 'five'].map((message) => event('shipping', { message }))

    expect(describeActivity(session([...commits, event('testing', {}, 0)]))).toEqual([
      'Committed: one',
      'Committed: two',
      'Committed: three, plus 2 more changes',
      'Tests passing (1 run)',
    ])
  })

  it('words removals separately from additions', () => {
    const events = [
      event('dependencies', { tool: 'npm', packages: ['zod'] }),
      event('dependencies', { tool: 'npm', packages: ['lodash'], action: 'remove' }),
    ]

    expect(describeActivity(session(events))).toEqual(['Added dependencies: zod', 'Removed dependencies: lodash'])
  })

  it('lists at most six packages', () => {
    const packages = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

    expect(describeActivity(session([event('dependencies', { packages })]))).toEqual([
      'Added dependencies: a, b, c, d, e, f, plus 2 more',
    ])
  })

  it('skips categories excluded by default but keeps notes', () => {
    const events = [event('linting', {}, 1), event('exploring', { tool: 'grep' }), event('note', { text: 'kept' })]

    expect(describeActivity(session(events))).toEqual(['Note: kept'])
  })

  it('counts a default-excluded category when includeCategories opts in', () => {
    const events = [event('linting', {}, 1), event('linting', {}, 0)]

    expect(countIncludedEvents(session(events))).toBe(0)
    expect(countIncludedEvents(session(events), ['linting'])).toBe(2)
  })

  it('is empty when nothing notable happened', () => {
    const events = [event('other', { target: 'deploy' }), event('versioning', { subcommand: 'status' })]

    expect(describeActivity(session(events))).toEqual([])
  })

  it('never prints raw hints, or names a tool only launched from the shell', () => {
    const events = [
      { ...event('other', {}), hint: 'curl -H "Authorization: secret" https://example.com' },
      event('ai_session', { tool: 'claude', commits: ['add refresh endpoint'] }),
    ]
    const output = describeActivity(session(events)).join('\n')

    expect(output).not.toContain('claude')
    expect(output).not.toContain('curl')
    expect(output).toContain('Committed: add refresh endpoint')
  })

  it('is deterministic', () => {
    const events = [event('testing', {}, 1), event('testing', {}, 0), event('shipping', { message: 'fix' })]

    expect(describeActivity(session(events))).toEqual(describeActivity(session(events)))
  })
})

describe('describeActivity — work a coding agent did', () => {
  const byAgent = (category: string, metadata: Record<string, unknown> = {}, exitCode: number | null = 0) => ({
    ...event(category, metadata, exitCode),
    source: 'claude-code',
    agentSessionId: 1,
  })

  it("leaves an agent's edits out of the editor's saves", () => {
    const events = [byAgent('code_edit'), byAgent('code_edit'), event('code_edit')]

    expect(describeActivity(session(events))).toEqual([
      'Worked with Claude Code (1 session)',
      'Edited files in the IDE (1 save)',
    ])
  })

  it('counts the sessions of every event, including ones the summary leaves out', () => {
    const events = [
      byAgent('testing'),
      { ...byAgent('exploring', { tool: 'grep' }), agentSessionId: 2 },
      byAgent('other'),
      event('testing'),
    ]

    expect(describeActivity(session(events))).toContain('Worked with Claude Code (2 sessions)')
  })

  it('sits after pushes and before IDE edits', () => {
    const events = [event('shipping', { remote: 'origin', branch: 'main' }), byAgent('testing'), event('code_edit')]

    expect(describeActivity(session(events))).toEqual([
      'Tests passing (1 run)',
      'Pushed to origin/main',
      'Worked with Claude Code (1 session)',
      'Edited files in the IDE (1 save)',
    ])
  })

  it('is the only bullet when the agent only explored', () => {
    const events = [byAgent('exploring', { tool: 'cat' }), byAgent('other')]

    expect(describeActivity(session(events, { project: 'api' }))).toEqual(['Worked with Claude Code (1 session)'])
  })

  it('stays within the bullet cap', () => {
    const events = [
      event('note', { text: 'one' }),
      event('note', { text: 'two' }),
      event('shipping', { message: 'a' }),
      event('shipping', { message: 'b' }),
      event('shipping', { message: 'c' }),
      byAgent('testing'),
      byAgent('building'),
      event('shipping', { remote: 'origin', branch: 'main' }),
    ]

    expect(describeActivity(session(events))).toHaveLength(7)
  })

  it('says nothing about an agent when none worked', () => {
    expect(describeActivity(session([event('testing')])).join('\n')).not.toContain('Worked with')
  })

  it('never prints the commands the agent ran', () => {
    const events = [
      { ...byAgent('other'), hint: 'pnpm nx test shell --skip-nx-cache 2>&1 | tail -40' },
      byAgent('ai_session', { tool: 'claude' }),
      byAgent('testing', { tool: 'nx', target: 'test' }),
    ]
    const output = describeActivity(session(events)).join('\n')

    expect(output).not.toMatch(/pnpm|nx test|tail/i)
  })
})
