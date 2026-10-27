import { describe, it, expect } from 'vitest'
import { collectCommits, describeOutcome, describeSession } from '../../../../src/ai/engines/template/describe'
import { TEST_WORDING } from '../../../../src/ai/engines/template/constants'
import { event, session } from './fixtures'

describe('collectCommits', () => {
  it('collects git commit messages and AI-session commits in order without repeats', () => {
    const events = [
      event('shipping', { message: 'fix: token validation' }),
      event('ai_session', { tool: 'claude', commits: ['add refresh endpoint', 'fix: token validation'] }),
      event('shipping', { message: null }),
    ]

    expect(collectCommits(events)).toEqual(['fix: token validation', 'add refresh endpoint'])
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

describe('describeSession', () => {
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

    expect(describeSession(session(events))).toEqual([
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

    expect(describeSession(session(notes))).toHaveLength(7)
  })

  it('folds commits beyond the third into the third bullet', () => {
    const commits = ['one', 'two', 'three', 'four', 'five'].map((message) => event('shipping', { message }))

    expect(describeSession(session([...commits, event('testing', {}, 0)]))).toEqual([
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

    expect(describeSession(session(events))).toEqual(['Added dependencies: zod', 'Removed dependencies: lodash'])
  })

  it('lists at most six packages', () => {
    const packages = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']

    expect(describeSession(session([event('dependencies', { packages })]))).toEqual([
      'Added dependencies: a, b, c, d, e, f, plus 2 more',
    ])
  })

  it('skips categories excluded by default but keeps notes', () => {
    const events = [event('linting', {}, 1), event('exploring', { tool: 'grep' }), event('note', { text: 'kept' })]

    expect(describeSession(session(events))).toEqual(['Note: kept'])
  })

  it('includes a default-excluded category when includeCategories opts in', () => {
    const events = [event('linting', {}, 1), event('linting', {}, 0)]

    expect(describeSession(session(events), ['linting'])).toEqual(['Worked in api-service (2 commands)'])
  })

  it('falls back to where the work happened when nothing else applies', () => {
    const events = [event('other', { target: 'deploy' }), event('versioning', { subcommand: 'status' })]

    expect(describeSession(session(events, { project: '~/scripts' }))).toEqual(['Worked in ~/scripts (2 commands)'])
  })

  it('never names the AI tool or prints raw hints', () => {
    const events = [
      { ...event('other', {}), hint: 'curl -H "Authorization: secret" https://example.com' },
      event('ai_session', { tool: 'claude', commits: ['add refresh endpoint'] }),
    ]
    const output = describeSession(session(events)).join('\n')

    expect(output).not.toContain('claude')
    expect(output).not.toContain('curl')
    expect(output).toContain('Committed: add refresh endpoint')
  })

  it('is deterministic', () => {
    const events = [event('testing', {}, 1), event('testing', {}, 0), event('shipping', { message: 'fix' })]

    expect(describeSession(session(events))).toEqual(describeSession(session(events)))
  })
})

describe('describeSession — work a coding agent did', () => {
  const byAgent = (category: string, metadata: Record<string, unknown> = {}, exitCode: number | null = 0) => ({
    ...event(category, metadata, exitCode),
    source: 'claude-code',
  })

  it('counts every command the agent ran, including ones the summary leaves out', () => {
    const events = [byAgent('testing'), byAgent('exploring', { tool: 'grep' }), byAgent('other'), event('testing')]

    expect(describeSession(session(events))).toContain('Worked with an AI coding assistant (3 commands)')
  })

  it('sits after pushes and before IDE edits', () => {
    const events = [event('shipping', { remote: 'origin', branch: 'main' }), byAgent('testing'), event('code_edit')]

    expect(describeSession(session(events))).toEqual([
      'Tests passing (1 run)',
      'Pushed to origin/main',
      'Worked with an AI coding assistant (1 command)',
      'Edited files in the IDE (1 save)',
    ])
  })

  it('replaces the "Worked in" fallback when the agent only explored', () => {
    const events = [byAgent('exploring', { tool: 'cat' }), byAgent('other')]

    expect(describeSession(session(events, { project: 'api' }))).toEqual([
      'Worked with an AI coding assistant (2 commands)',
    ])
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

    expect(describeSession(session(events))).toHaveLength(7)
  })

  it('says nothing about an agent when none ran commands', () => {
    expect(describeSession(session([event('testing')])).join('\n')).not.toContain('AI coding assistant')
  })

  it('never names the tool or prints the commands the agent ran', () => {
    const events = [
      { ...byAgent('other'), hint: 'pnpm nx test shell --skip-nx-cache 2>&1 | tail -40' },
      byAgent('ai_session', { tool: 'claude' }),
      byAgent('testing', { tool: 'nx', target: 'test' }),
    ]
    const output = describeSession(session(events)).join('\n')

    expect(output).not.toMatch(/claude|pnpm|nx test|tail/i)
  })
})
