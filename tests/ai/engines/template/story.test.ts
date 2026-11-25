import { describe, it, expect } from 'vitest'
import {
  branchGroupsOf,
  renderSessionStory,
  storyLines,
  storyOfBranch,
} from '../../../../src/ai/engines/template/story'
import { commit, event, onBranch, session } from './fixtures'

const byAgent = (category: string, exitCode: number | null = null) => ({
  ...event(category, {}, exitCode),
  source: 'claude-code',
  agentSessionId: 1,
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
    expect(storyLines(session(unknown))).toEqual(['- Ran tests', '- Ran builds', 'With Claude Code (1 session)'])
  })

  it('names no branch in the bullets: the heading already does', () => {
    expect(renderSessionStory(session([event('testing')]))).toBe('## api-service (feature/auth) — 2h\n- Tests passing')
  })

  it('tells every commit, folding none away', () => {
    const commits = ['one', 'two', 'three', 'four', 'five'].map((subject) => commit(subject))

    expect(storyLines(session([], { commits }))).toEqual([
      '- Committed: one',
      '- Committed: two',
      '- Committed: three',
      '- Committed: four',
      '- Committed: five',
    ])
  })

  it('says it installed dependencies, without counting runs, when no package was named', () => {
    expect(storyLines(session([event('dependencies', { tool: 'npm' })]))).toEqual(['- Installed dependencies'])
  })

  it('says it removed dependencies, without counting runs, when a removal named no package', () => {
    const events = [event('dependencies', { tool: 'npm', action: 'remove' })]

    expect(storyLines(session(events))).toEqual(['- Removed dependencies'])
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

  it('tells everything on every branch, with no cap: the story is a full record', () => {
    const many = ['b1', 'b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9']
    const events = many.flatMap((branch) => [onBranch(branch, event('testing')), onBranch(branch, event('building'))])
    const commits = many.map((branch) => commit(`work on ${branch}`, branch))

    const lines = storyLines(session(events, { branches: many, commits }))

    expect(lines.filter((line) => line.startsWith('On '))).toHaveLength(9)
    expect(lines.filter((line) => line.startsWith('- '))).toHaveLength(27)
  })
})

describe('storyLines — activity', () => {
  it('closes with one line for the agent and the editor, after the work', () => {
    const events = [byAgent('exploring'), byAgent('testing', 0), event('code_edit'), event('code_edit')]

    expect(storyLines(session(events))).toEqual([
      '- Tests passing',
      'With Claude Code (1 session) · 2 file saves in the editor',
    ])
  })

  it('says in one honest line when there was nothing but activity', () => {
    const events = [byAgent('exploring'), byAgent('other')]

    expect(storyLines(session(events, { project: 'api', durationMinutes: 45 }))).toEqual([
      '- Explored and ran commands',
      'With Claude Code (1 session)',
    ])
  })

  it('counts sessions, not commands, and leaves out a count it does not have', () => {
    const twoSessions = [byAgent('testing', 0), { ...byAgent('other'), agentSessionId: 2 }]
    const noIds = [{ ...event('testing', {}, 0), source: 'claude-code' }]

    expect(storyLines(session(twoSessions))).toContain('With Claude Code (2 sessions)')
    expect(storyLines(session(noIds))).toContain('With Claude Code')
  })

  it('never takes the editor for an agent', () => {
    const save = { ...event('code_edit'), source: 'vscode', agentSessionId: 9 }

    expect(storyLines(session([save]))).toEqual(['- Edited files', '1 file save in the editor'])
  })

  it("counts an agent's edits as its work, never as saves in the editor", () => {
    const events = [byAgent('code_edit'), byAgent('code_edit'), event('code_edit')]

    expect(storyLines(session(events))).toEqual([
      '- Edited files',
      'With Claude Code (1 session) · 1 file save in the editor',
    ])
  })

  it('says files were edited when only an agent edited them', () => {
    expect(storyLines(session([byAgent('code_edit')]))).toEqual(['- Edited files', 'With Claude Code (1 session)'])
  })

  it('says files were edited when that was all', () => {
    expect(storyLines(session([event('code_edit')], { project: 'api', durationMinutes: 10 }))).toEqual([
      '- Edited files',
      '1 file save in the editor',
    ])
  })

  it('tells the changed files per branch, the editor and the agent apart', () => {
    const saved = { ...event('code_edit', { linesAdded: 200, linesRemoved: 40 }), source: 'vscode', filePath: '/a.ts' }
    const edited = {
      ...byAgent('code_edit'),
      metadata: { linesAdded: 120, linesRemoved: 45 },
      filePath: '/b.ts',
    }

    expect(storyLines(session([saved, edited]))).toEqual([
      '- Changed 2 files (+320 −85): 1 in the editor (+200 −40), 1 with Claude Code (+120 −45)',
      'With Claude Code (1 session) · 1 file save in the editor',
    ])
  })

  it("closes with the agent's recap and counts when a session left one", () => {
    const edited = { ...byAgent('code_edit'), metadata: { linesAdded: 1, linesRemoved: 0 }, filePath: '/b.ts' }
    const agentSessions = [
      { id: 1, source: 'claude-code', lastSeenAt: '2026-10-20T10:00:00Z', recap: 'Added reading. Done.' },
    ]

    expect(storyLines(session([byAgent('testing', 0), edited], { agentSessions }))).toEqual([
      '- Changed 1 file (+1 −0) with Claude Code',
      '- Tests passing',
      'With Claude Code: Added reading (1 session, 1 file changed)',
    ])
  })

  it('leaves the closing line as it was when the recap is not there', () => {
    const agentSessions = [{ id: 1, source: 'claude-code', lastSeenAt: '2026-10-20T10:00:00Z', recap: null }]

    expect(storyLines(session([byAgent('testing', 0)], { agentSessions }))).toContain('With Claude Code (1 session)')
  })

  it('never prints raw hints or commands', () => {
    const events = [
      { ...byAgent('other'), hint: 'pnpm nx test shell --skip-nx-cache 2>&1 | tail -40' },
      byAgent('ai_session'),
    ]
    const output = renderSessionStory(session(events, { commits: [commit('add refresh endpoint')] }))

    expect(output).not.toMatch(/pnpm|nx test|tail/i)
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

const reading = (...reads: string[]) => ({ ...event('exploring'), reads })
const PLAN = 'docs/plan/WOR-179-remove-old-data-after-100-days.md'
const TICKET_BRANCH = 'feat/WOR-179-remove-old-data-after-100-days'
const TICKET_TOPIC = '- WOR-179: remove old data after 100 days'

describe('storyLines: what was read', () => {
  it('tells what was read first, before the commits and outcomes', () => {
    const events = [reading(PLAN), event('testing')]

    expect(storyLines(session(events, { commits: [commit('fix: token validation')] }))).toEqual([
      '- Read the WOR-179 plan',
      '- Committed: fix: token validation',
      '- Tests passing',
    ])
  })

  it('keeps a branch that only read, and drops the quiet line for it', () => {
    expect(storyLines(session([reading('src/db/x.ts')]))).toEqual(['- Read src/db/x.ts'])
  })

  it('keeps the quiet line for exploring that read nothing it can name', () => {
    expect(storyLines(session([event('exploring')]))).toEqual(['- Explored and ran commands'])
  })

  it('tells each branch what it read', () => {
    const events = [
      onBranch('feature/auth', reading('src/db/x.ts')),
      onBranch('main', reading('docs/site/a.md')),
      onBranch('main', event('testing')),
    ]

    expect(storyLines(session(events, { branches: ['feature/auth', 'main'], branch: 'main' }))).toEqual([
      'On feature/auth:',
      '- Read src/db/x.ts',
      'On main:',
      '- Read docs/site/a.md',
      '- Tests passing',
    ])
  })

  it('keeps a read with no branch with the branch before it, as the rest of the story does', () => {
    const events = [
      onBranch('feature/auth', event('testing')),
      onBranch('main', event('testing')),
      onBranch(null, reading('src/db/x.ts')),
    ]

    expect(storyLines(session(events, { branches: ['feature/auth', 'main'], branch: 'main' }))).toEqual([
      'On feature/auth:',
      '- Tests passing',
      'On main:',
      '- Read src/db/x.ts',
      '- Tests passing',
    ])
  })

  it('tells reads of a session with no branch at all', () => {
    const events = [onBranch(null, reading('src/db/x.ts')), onBranch(null, event('testing'))]

    expect(storyLines(session(events, { branches: [], branch: null }))).toEqual([
      '- Read src/db/x.ts',
      '- Tests passing',
    ])
  })

  it('is not changed by asking for exploring events to be included', () => {
    const events = [reading(PLAN), event('testing')]

    expect(storyLines(session(events), ['exploring'])).toEqual(storyLines(session(events)))
  })

  it('leaves what the week tells about a branch as it was', () => {
    const [group] = branchGroupsOf(session([reading(PLAN), event('testing')]))

    expect(storyOfBranch(group).bullets).toEqual(['Tests passing'])
  })
})

describe('storyLines: what a branch was about', () => {
  const onTicket = (base = event('testing')) => onBranch(TICKET_BRANCH, base)
  const ticketSession = (events: ReturnType<typeof event>[], commits: ReturnType<typeof commit>[] = []) =>
    session(events, { branches: [TICKET_BRANCH], branch: TICKET_BRANCH, commits })

  it('leads with the topic of a branch no commit speaks for', () => {
    expect(storyLines(ticketSession([onTicket()]))).toEqual([TICKET_TOPIC, '- Tests passing'])
  })

  it('puts the topic before what was read', () => {
    const events = [onTicket(reading(PLAN)), onTicket()]

    expect(storyLines(ticketSession(events))).toEqual([TICKET_TOPIC, '- Read the WOR-179 plan', '- Tests passing'])
  })

  it('leaves the topic out when a commit says what the work was', () => {
    expect(storyLines(ticketSession([onTicket()], [commit('fix: x', TICKET_BRANCH)]))).toEqual([
      '- Committed: fix: x',
      '- Tests passing',
    ])
  })

  it('never lets the topic stand alone', () => {
    expect(storyLines(ticketSession([onTicket(event('exploring'))]))).toEqual(['- Explored and ran commands'])
  })

  it('says nothing of the topic of a branch with no ticket key', () => {
    expect(storyLines(session([event('testing')]))).toEqual(['- Tests passing'])
  })
})

describe('storyLines: what a commit changed', () => {
  const sized = (subject: string, size: { files: number; added: number; removed: number }) => ({
    ...commit(subject),
    size,
  })

  it('tells the size of a commit after its subject', () => {
    const commits = [sized('fix(db): keep a day', { files: 5, added: 86, removed: 31 })]

    expect(storyLines(session([], { commits }))).toEqual(['- Committed: fix(db): keep a day (5 files, +86 −31)'])
  })

  it('says one file in the singular, and keeps a size of no lines', () => {
    const commits = [
      sized('docs: one', { files: 1, added: 3, removed: 0 }),
      sized('feat: binary', { files: 2, added: 0, removed: 0 }),
    ]

    expect(storyLines(session([], { commits }))).toEqual([
      '- Committed: docs: one (1 file, +3 −0)',
      '- Committed: feat: binary (2 files, +0 −0)',
    ])
  })

  it('tells a commit git did not size by its subject alone', () => {
    expect(storyLines(session([], { commits: [commit('fix: x')] }))).toEqual(['- Committed: fix: x'])
  })
})

describe('storyLines: scripts whose body is not stored', () => {
  const LINE = 'may have changed files (contents not captured)'
  const ranScript = (count: number, capturedAt: string, category = 'running') => ({
    ...event(category),
    capturedAt,
    scripts: count,
  })

  it('says scripts ran, when no commit speaks for them', () => {
    expect(storyLines(session([ranScript(4, '2026-10-20T10:00:00.000Z')]))).toEqual([`- Ran 4 scripts that ${LINE}`])
  })

  it('tells the scripts after the last commit, right after the commits, and never a file count', () => {
    const events = [
      ranScript(2, '2026-10-20T09:00:00.000Z'),
      ranScript(1, '2026-10-20T11:00:00.000Z'),
      event('testing'),
    ]
    const commits = [{ ...commit('fix: x'), committedAt: '2026-10-20T10:00:00.000Z' }]

    expect(storyLines(session(events, { commits }))).toEqual([
      '- Committed: fix: x',
      `- Ran 1 script that ${LINE}`,
      '- Tests passing',
    ])
  })

  it('leaves them out when a commit came after them all', () => {
    const commits = [{ ...commit('fix: x'), committedAt: '2026-10-20T12:00:00.000Z' }]

    expect(storyLines(session([ranScript(3, '2026-10-20T10:00:00.000Z')], { commits }))).toEqual([
      '- Committed: fix: x',
    ])
  })

  it('counts a script filed under a category the story leaves out, and instead of the quiet line', () => {
    const lines = storyLines(session([ranScript(1, '2026-10-20T10:00:00.000Z', 'linting')]))

    expect(lines).toEqual([`- Ran 1 script that ${LINE}`])
  })

  it('tells each branch its own scripts', () => {
    const events = [
      onBranch('feature/auth', ranScript(1, '2026-10-20T10:00:00.000Z')),
      onBranch('main', ranScript(2, '2026-10-20T10:05:00.000Z')),
    ]

    expect(storyLines(session(events, { branches: ['feature/auth', 'main'], branch: 'main' }))).toEqual([
      'On feature/auth:',
      `- Ran 1 script that ${LINE}`,
      'On main:',
      `- Ran 2 scripts that ${LINE}`,
    ])
  })

  it('does not tell the week about them: the week keeps to what it always told', () => {
    const [group] = branchGroupsOf(session([ranScript(2, '2026-10-20T10:00:00.000Z'), event('testing')]))

    expect(storyOfBranch(group).bullets).toEqual(['Tests passing'])
  })
})
