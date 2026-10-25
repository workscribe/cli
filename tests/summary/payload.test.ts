import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/utils/format', () => ({
  formatDate: vi.fn((isoString: string) => `time:${isoString}`),
}))

import {
  eventRowToPayload,
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
    })
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
    })
  })

  it('leaves a hint in metadata for categories other than other', () => {
    const row = makeEvent({ category: 'testing', metadata: '{"hint":"vitest","tool":"npx"}' })

    expect(eventRowToPayload(row)).toEqual({
      category: 'testing',
      metadata: { hint: 'vitest', tool: 'npx' },
      exitCode: 0,
      durationMs: 50,
    })
  })
})

describe('sessionToPayload', () => {
  it('maps the session for the given date', () => {
    expect(sessionToPayload(makeSession(), '2026-08-17')).toEqual({
      date: '2026-08-17',
      project: 'my-app',
      branch: 'main',
      startTime: 'time:2026-08-17T09:00:00.000Z',
      endTime: 'time:2026-08-17T10:00:00.000Z',
      durationMinutes: 60,
      events: [{ category: 'shipping', metadata: { message: 'fix: bug' }, exitCode: 0, durationMs: 50 }],
    })
  })

  it('has a null branch when the session has no events', () => {
    expect(sessionToPayload(makeSession({ events: [] }), '2026-08-17').branch).toBeNull()
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

    expect(sessionToPayload(session, '2026-08-17', NO_OVERRIDES).project).toBe('~/scripts')
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
