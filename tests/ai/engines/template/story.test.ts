import { describe, it, expect } from 'vitest'
import { renderSessionStory, storyLines } from '../../../../src/ai/engines/template/story'
import { commit, event, onBranch, session } from './fixtures'

const byAgent = (category: string, exitCode: number | null = null) => ({
  ...event(category, {}, exitCode),
  source: 'claude-code',
})

describe('storyLines — one branch', () => {
  it('leads with notes, then commits, outcomes, dependencies, releases and pushes', () => {
    const events = [
      event('shipping', { remote: 'origin', branch: 'feature/auth' }),
      event('releasing', { tool: 'vercel' }),
      event('dependencies', { tool: 'npm', packages: ['bcrypt'] }),
      event('building', {}, 0),
      event('testing', {}, 1),
      event('testing', {}, 0),
      event('note', { text: 'blocked on staging creds' }),
    ]

    expect(storyLines(session(events, { commits: [commit('fix: token validation')] }))).toEqual([
      '- Note: blocked on staging creds',
      '- Committed: fix: token validation',
      '- Tests now passing',
      '- Build passing',
      '- Added dependencies: bcrypt',
      '- Released / deployed (vercel)',
      '- Pushed to origin/feature/auth',
    ])
  })

  it('says how runs turned out, never how many there were', () => {
    const failing = [event('testing', {}, 0), event('testing', {}, 1)]
    const unknown = [byAgent('testing'), byAgent('building')]

    expect(storyLines(session(failing))).toEqual(['- Tests failing'])
    expect(storyLines(session(unknown))).toEqual([
      '- Ran tests',
      '- Ran builds',
      'With an AI coding assistant (2 commands)',
    ])
  })

  it('names no branch in the bullets: the heading already does', () => {
    expect(renderSessionStory(session([event('testing')]))).toBe('## api-service (feature/auth) — 2h\n- Tests passing')
  })

  it('folds commits beyond the third into the third bullet', () => {
    const commits = ['one', 'two', 'three', 'four', 'five'].map((subject) => commit(subject))

    expect(storyLines(session([], { commits }))).toEqual([
      '- Committed: one',
      '- Committed: two',
      '- Committed: three, plus 2 more changes',
    ])
  })

  it('says it installed dependencies, without counting runs, when no package was named', () => {
    expect(storyLines(session([event('dependencies', { tool: 'npm' })]))).toEqual(['- Installed dependencies'])
  })
})

describe('storyLines — several branches', () => {
  const branches = ['main', 'feat/auth']

  it('groups the work under a plain "On <branch>:" line per branch, in the order first seen', () => {
    const events = [onBranch('main', event('testing', {}, 1)), onBranch('feat/auth', event('building', {}, 0))]
    const commits = [commit('feat: login', 'feat/auth'), commit('chore: tidy', 'main')]

    expect(storyLines(session(events, { branch: 'feat/auth', branches, commits }))).toEqual([
      'On main:',
      '- Committed: chore: tidy',
      '- Tests failing',
      'On feat/auth:',
      '- Committed: feat: login',
      '- Build passing',
    ])
  })

  it('keeps an event with no branch with the branch before it', () => {
    const events = [onBranch('main', event('testing', {}, 0)), onBranch(null, event('building', {}, 1))]

    expect(storyLines(session(events, { branches }))).toEqual(['On main:', '- Tests passing', '- Build failing'])
  })

  it('tells a commit on no known branch under the first branch', () => {
    const lines = storyLines(session([], { branches, commits: [commit('from the agent', null)] }))

    expect(lines).toEqual(['On main:', '- Committed: from the agent'])
  })

  it("caps the work at 7 bullets, keeping each branch's first", () => {
    const mainWork = [
      event('testing'),
      event('building'),
      event('dependencies', { packages: ['zod'] }),
      event('releasing', { tool: 'npm' }),
      event('shipping', { remote: 'origin', branch: 'main' }),
    ].map((base) => onBranch('main', base))
    const commits = [commit('a', 'main'), commit('b', 'main'), commit('c', 'main'), commit('late', 'feat/auth')]
    const events = [...mainWork, onBranch('feat/auth', event('testing'))]

    const lines = storyLines(session(events, { branches, commits }))

    // main has 8 bullets and feat/auth 2: main keeps 6, and feat/auth still gets its first
    expect(lines.filter((line) => line.startsWith('- '))).toHaveLength(7)
    expect(lines.slice(lines.indexOf('On feat/auth:'))).toEqual(['On feat/auth:', '- Committed: late'])
  })

  it('names the branches past the first six in one line', () => {
    const many = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9']
    const events = many.map((branch) => onBranch(branch, event('testing')))

    const lines = storyLines(session(events, { branches: many }))

    expect(lines.filter((line) => line.startsWith('On '))).toHaveLength(6)
    expect(lines.at(-1)).toBe('Also on 3 more branches: b7, b8, b9')
  })
})

describe('storyLines — activity', () => {
  it('closes with one line for the agent and the editor, after the work', () => {
    const events = [byAgent('exploring'), byAgent('testing', 0), event('code_edit'), event('code_edit')]

    expect(storyLines(session(events))).toEqual([
      '- Tests passing',
      'With an AI coding assistant (2 commands) · 2 file saves in the editor',
    ])
  })

  it('says in one honest line when there was nothing but activity', () => {
    const events = [byAgent('exploring'), byAgent('other')]

    expect(storyLines(session(events, { project: 'api', durationMinutes: 45 }))).toEqual([
      '- Explored and ran commands',
      'With an AI coding assistant (2 commands)',
    ])
  })

  it('says files were edited when that was all', () => {
    expect(storyLines(session([event('code_edit')], { project: 'api', durationMinutes: 10 }))).toEqual([
      '- Edited files',
      '1 file save in the editor',
    ])
  })

  it('never names the AI tool or prints raw hints or commands', () => {
    const events = [
      { ...byAgent('other'), hint: 'pnpm nx test shell --skip-nx-cache 2>&1 | tail -40' },
      byAgent('ai_session'),
    ]
    const output = renderSessionStory(session(events, { commits: [commit('add refresh endpoint')] }))

    expect(output).not.toMatch(/claude|pnpm|nx test|tail/i)
    expect(output).toContain('Committed: add refresh endpoint')
  })
})

describe('renderSessionStory', () => {
  it('starts with the heading naming every branch, and uses only "## ", "- " and plain lines', () => {
    const events = [onBranch('main', event('testing')), onBranch('feat/auth', event('code_edit'))]

    const story = renderSessionStory(session(events, { branches: ['main', 'feat/auth'] }))

    expect(story).toBe('## api-service (main, feat/auth) — 2h\nOn main:\n- Tests passing\n1 file save in the editor')
    expect(story).not.toMatch(/`|###/)
  })

  it('is deterministic', () => {
    const events = [event('testing', {}, 1), event('testing', {}, 0)]

    expect(renderSessionStory(session(events))).toBe(renderSessionStory(session(events)))
  })
})
