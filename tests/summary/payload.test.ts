import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/utils/format', () => ({
  formatDate: vi.fn((isoString: string) => `time:${isoString}`),
}))

import {
  branchesOf,
  eventRowToPayload,
  sessionBranch,
  sessionToPayload,
  buildDayPayload,
  sessionLocation,
  repoCwd,
} from '../../src/summary/payload'
import type { EventRow } from '../../src/db/types'
import type { Session } from '../../src/sessions/detector'

function makeEvent(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 1,
    captured_at: '2026-08-17T09:00:00.000Z',
    command: 'git commit -m "fix: bug"',
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 50,
    repo_name: 'my-app',
    branch: 'main',
    category: 'shipping',
    metadata: '{"message":"fix: bug"}',
    source: 'shell',
    file_path: null,
    ...overrides,
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 1,
    date: '2026-08-17',
    startedAt: '2026-08-17T09:00:00.000Z',
    endedAt: '2026-08-17T10:00:00.000Z',
    repoName: 'my-app',
    durationMinutes: 60,
    eventCount: 1,
    summary: null,
    events: [makeEvent()],
    ...overrides,
  }
}

describe('eventRowToPayload', () => {
  it('maps the row and parses its metadata', () => {
    expect(eventRowToPayload(makeEvent())).toEqual({
      category: 'shipping',
      metadata: { message: 'fix: bug' },
      exitCode: 0,
      durationMs: 50,
      branch: 'main',
      capturedAt: '2026-08-17T09:00:00.000Z',
      source: 'shell',
    })
  })

  it('reads the branch moves in a git command, so the story can tell them', () => {
    const row = makeEvent({ category: 'versioning', command: 'git switch -c feat/x', metadata: '{"branch":"feat/x"}' })

    expect(eventRowToPayload(row).gitMoves).toEqual([{ kind: 'create-branch', branch: 'feat/x' }])
  })

  it('keeps the new branch from a compound command that failed later, since the session is on it', () => {
    const row = makeEvent({ command: 'git switch -c feat/x && npm test', exit_code: 1, branch: 'feat/x' })

    expect(eventRowToPayload(row).gitMoves).toEqual([{ kind: 'create-branch', branch: 'feat/x' }])
  })

  it('reads no moves from a git command that failed, or from one that is not git', () => {
    expect(eventRowToPayload(makeEvent({ command: 'git reset --hard', exit_code: 128 }))).not.toHaveProperty('gitMoves')
    expect(eventRowToPayload(makeEvent({ command: 'npm test' }))).not.toHaveProperty('gitMoves')
  })

  it('carries no source for an event that has none', () => {
    expect(eventRowToPayload(makeEvent({ source: null }))).not.toHaveProperty('source')
  })

  it('carries the source of a command a coding agent ran', () => {
    expect(eventRowToPayload(makeEvent({ source: 'claude-code' })).source).toBe('claude-code')
  })

  it('falls back to empty metadata when the JSON is invalid', () => {
    expect(eventRowToPayload(makeEvent({ metadata: '{not json' })).metadata).toEqual({})
  })

  it.each(['null', '5', '"text"', '[1, 2]'])(
    'falls back to empty metadata when the JSON is %s, not an object',
    (raw) => {
      expect(eventRowToPayload(makeEvent({ category: 'other', metadata: raw })).metadata).toEqual({})
    }
  )

  it('falls back to empty metadata when there is none', () => {
    expect(eventRowToPayload(makeEvent({ metadata: null })).metadata).toEqual({})
  })

  it('lifts the hint out of other events and strips hint and tool', () => {
    const row = makeEvent({ category: 'other', metadata: '{"hint":"make deploy","tool":"make","target":"prod"}' })

    expect(eventRowToPayload(row)).toEqual({
      category: 'other',
      hint: 'make deploy',
      metadata: { target: 'prod' },
      exitCode: 0,
      durationMs: 50,
      branch: 'main',
      capturedAt: '2026-08-17T09:00:00.000Z',
      source: 'shell',
    })
  })

  it('leaves a hint in metadata for categories other than other', () => {
    const row = makeEvent({ category: 'testing', metadata: '{"hint":"vitest","tool":"npx"}' })

    expect(eventRowToPayload(row)).toEqual({
      category: 'testing',
      metadata: { hint: 'vitest', tool: 'npx' },
      exitCode: 0,
      durationMs: 50,
      branch: 'main',
      capturedAt: '2026-08-17T09:00:00.000Z',
      source: 'shell',
    })
  })
})

describe('sessionToPayload', () => {
  it('maps the session for the given date', () => {
    expect(sessionToPayload(makeSession(), '2026-08-17')).toEqual({
      date: '2026-08-17',
      project: 'my-app',
      branch: 'main',
      branches: ['main'],
      startTime: 'time:2026-08-17T09:00:00.000Z',
      endTime: 'time:2026-08-17T10:00:00.000Z',
      durationMinutes: 60,
      events: [
        {
          category: 'shipping',
          metadata: { message: 'fix: bug' },
          exitCode: 0,
          durationMs: 50,
          branch: 'main',
          capturedAt: '2026-08-17T09:00:00.000Z',
          source: 'shell',
        },
      ],
      commits: [{ hash: null, subject: 'fix: bug', committedAt: '2026-08-17T09:00:00.000Z', branch: 'main' }],
    })
  })

  it('has a null branch and no branches when the session has no events', () => {
    const payload = sessionToPayload(makeSession({ events: [] }), '2026-08-17')

    expect(payload.branch).toBeNull()
    expect(payload.branches).toEqual([])
  })
})

describe('sessionBranch', () => {
  it('is the latest branch the session was on, where the work was heading', () => {
    const events = ['main', 'feat/auth', 'main', 'feat/auth'].map((branch) => makeEvent({ branch }))

    expect(sessionBranch(events)).toBe('feat/auth')
  })

  it('skips later events outside a repo', () => {
    expect(sessionBranch([makeEvent({ branch: 'main' }), makeEvent({ branch: null })])).toBe('main')
  })

  it('is null when no event has a branch', () => {
    expect(sessionBranch([makeEvent({ branch: null })])).toBeNull()
    expect(sessionBranch([])).toBeNull()
  })
})

describe('sessionToPayload — branch and commits', () => {
  it('takes the latest branch, and git commits passed in, each under its branch', () => {
    const events = [
      makeEvent({ id: 1, branch: 'main', captured_at: '2026-08-17T09:00:00.000Z' }),
      makeEvent({
        id: 2,
        branch: 'feat/auth',
        captured_at: '2026-08-17T09:30:00.000Z',
        category: 'testing',
        metadata: null,
      }),
    ]
    const gitCommits = [{ hash: 'a1b2c3d', subject: 'feat: add login', committedAt: '2026-08-17T10:40:00+01:00' }]

    const payload = sessionToPayload(makeSession({ events }), '2026-08-17', { gitCommits })

    expect(payload.branch).toBe('feat/auth')
    expect(payload.commits).toEqual([
      { hash: 'a1b2c3d', subject: 'feat: add login', committedAt: '2026-08-17T10:40:00+01:00', branch: 'feat/auth' },
      { hash: null, subject: 'fix: bug', committedAt: '2026-08-17T09:00:00.000Z', branch: 'main' },
    ])
  })
})

describe('branchesOf', () => {
  it('lists each branch once, in the order first seen', () => {
    const events = ['main', 'feat/auth', 'main', 'fix/typo', 'feat/auth'].map((branch) => makeEvent({ branch }))

    expect(branchesOf(events)).toEqual(['main', 'feat/auth', 'fix/typo'])
  })

  it('skips events outside a repo, which have no branch', () => {
    const events = [makeEvent({ branch: null }), makeEvent({ branch: 'main' }), makeEvent({ branch: null })]

    expect(branchesOf(events)).toEqual(['main'])
  })

  it('is empty when no event has a branch', () => {
    expect(branchesOf([makeEvent({ branch: null })])).toEqual([])
  })
})

describe('buildDayPayload', () => {
  it('maps every session under the given date', () => {
    const payload = buildDayPayload('2026-08-17', [makeSession(), makeSession({ repoName: 'api' })])

    expect(payload.date).toBe('2026-08-17')
    expect(payload.sessions.map((session) => session.project)).toEqual(['my-app', 'api'])
  })
})

describe('sessionLocation', () => {
  const HOME = '/Users/dev'
  const NO_OVERRIDES = { projects: {}, homeDir: HOME }

  it('uses the repo name for sessions in a git repo', () => {
    expect(sessionLocation(makeSession(), NO_OVERRIDES)).toBe('my-app')
  })

  it('falls back to the home-relative directory outside a git repo', () => {
    const session = makeSession({
      repoName: null,
      events: [makeEvent({ repo_name: null, cwd: '/Users/dev/Downloads/scripts' })],
    })

    expect(sessionLocation(session, NO_OVERRIDES)).toBe('~/Downloads/scripts')
  })

  it('shows the home directory itself as ~', () => {
    const session = makeSession({ repoName: null, events: [makeEvent({ repo_name: null, cwd: HOME })] })

    expect(sessionLocation(session, NO_OVERRIDES)).toBe('~')
  })

  it('keeps directories outside home absolute', () => {
    const session = makeSession({ repoName: null, events: [makeEvent({ repo_name: null, cwd: '/tmp/build' })] })

    expect(sessionLocation(session, NO_OVERRIDES)).toBe('/tmp/build')
  })

  it('names the directory most of the commands ran in', () => {
    const session = makeSession({
      repoName: null,
      events: [
        makeEvent({ repo_name: null, cwd: '/Users/dev/notes' }),
        makeEvent({ repo_name: null, cwd: '/Users/dev/scripts' }),
        makeEvent({ repo_name: null, cwd: '/Users/dev/scripts' }),
      ],
    })

    expect(sessionLocation(session, NO_OVERRIDES)).toBe('~/scripts')
  })

  it('prefers a config.projects display name for that directory', () => {
    const session = makeSession({ repoName: null, events: [makeEvent({ repo_name: null, cwd: '/Users/dev/scripts' })] })

    expect(sessionLocation(session, { projects: { '/Users/dev/scripts': 'Shell scripts' }, homeDir: HOME })).toBe(
      'Shell scripts'
    )
  })

  it('is null for a session with no repo and no events', () => {
    expect(sessionLocation(makeSession({ repoName: null, events: [] }), NO_OVERRIDES)).toBeNull()
  })

  it('becomes the payload project', () => {
    const session = makeSession({ repoName: null, events: [makeEvent({ repo_name: null, cwd: '/Users/dev/scripts' })] })

    expect(sessionToPayload(session, '2026-08-17', { context: NO_OVERRIDES }).project).toBe('~/scripts')
  })
})

describe('repoCwd', () => {
  it("uses a directory inside the session's repo even when most commands ran from a parent directory", () => {
    const session = makeSession({
      repoName: 'movies',
      events: [
        makeEvent({ repo_name: null, cwd: '/Users/dev' }),
        makeEvent({ repo_name: null, cwd: '/Users/dev' }),
        makeEvent({ repo_name: 'movies', cwd: '/Users/dev/movies' }),
      ],
    })

    expect(repoCwd(session)).toBe('/Users/dev/movies')
  })

  it('falls back to the most-used directory for a session without a repo', () => {
    const session = makeSession({ repoName: null, events: [makeEvent({ repo_name: null, cwd: '/tmp/scripts' })] })

    expect(repoCwd(session)).toBe('/tmp/scripts')
  })
})
