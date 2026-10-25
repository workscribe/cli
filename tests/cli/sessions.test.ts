import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/sessions/detector', () => ({
  getOrBuildSessions: vi.fn(),
}))

vi.mock('../../src/config', () => ({
  readConfig: vi.fn(),
}))

vi.mock('../../src/summary/git-commits', () => ({
  getRepoRoot: vi.fn(),
  getUserEmail: vi.fn(),
  getCommitsInWindow: vi.fn(),
  getOthersSubjects: vi.fn(),
}))

import { Command } from 'commander'
import { getOrBuildSessions } from '../../src/sessions/detector'
import { log } from '../../src/utils/logger'
import { registerSessions } from '../../src/cli/sessions'
import { readConfig } from '../../src/config'
import { getRepoRoot, getUserEmail, getCommitsInWindow, getOthersSubjects } from '../../src/summary/git-commits'
import { createTestConfig } from '../helpers/config'

const mockGetOrBuildSessions = getOrBuildSessions as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const SAMPLE_SESSIONS = [
  {
    id: 1,
    date: '2026-05-28',
    startedAt: '2026-05-28T09:00:00Z',
    endedAt: '2026-05-28T10:30:00Z',
    repoName: 'myapp',
    durationMinutes: 90,
    eventCount: 15,
    summary: null,
    events: [],
  },
  {
    id: 2,
    date: '2026-05-28',
    startedAt: '2026-05-28T14:00:00Z',
    endedAt: '2026-05-28T15:00:00Z',
    repoName: 'api',
    durationMinutes: 60,
    eventCount: 8,
    summary: null,
    events: [],
  },
]

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerSessions(program)
  return program
}

describe('workscribe sessions', () => {
  describe('no sessions', () => {
    it('logs a no-sessions message', async () => {
      mockGetOrBuildSessions.mockReturnValue([])
      await makeProgram().parseAsync(['sessions'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('No sessions detected'))
    })
  })

  describe('with sessions', () => {
    it('logs a header with session count', async () => {
      mockGetOrBuildSessions.mockReturnValue(SAMPLE_SESSIONS)
      await makeProgram().parseAsync(['sessions'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('2 sessions'))
    })

    it('uses singular "session" for a single result', async () => {
      mockGetOrBuildSessions.mockReturnValue([SAMPLE_SESSIONS[0]])
      await makeProgram().parseAsync(['sessions'], { from: 'user' })
      const calls = mockLog.plain.mock.calls.map((call: unknown[]) => call[0] as string)
      expect(calls.some((call) => call.includes('1 session') && !call.includes('1 sessions'))).toBe(true)
    })

    it('logs a line per session containing the repo name', async () => {
      mockGetOrBuildSessions.mockReturnValue(SAMPLE_SESSIONS)
      await makeProgram().parseAsync(['sessions'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('myapp'))
    })

    it('shows "no repo" for sessions without a repo', async () => {
      mockGetOrBuildSessions.mockReturnValue([{ ...SAMPLE_SESSIONS[0], repoName: null }])
      await makeProgram().parseAsync(['sessions'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('no repo'))
    })
  })

  describe('notes', () => {
    it('displays note text indented under the session', async () => {
      mockGetOrBuildSessions.mockReturnValue([
        {
          ...SAMPLE_SESSIONS[0],
          events: [{ category: 'note', metadata: JSON.stringify({ text: 'Fixed race condition' }) }],
        },
      ])
      await makeProgram().parseAsync(['sessions'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('Fixed race condition'))
    })

    it('does not display note lines when there are no note events', async () => {
      mockGetOrBuildSessions.mockReturnValue([
        {
          ...SAMPLE_SESSIONS[0],
          events: [{ category: 'shipping', metadata: '{}' }],
        },
      ])
      await makeProgram().parseAsync(['sessions'], { from: 'user' })
      const calls = (mockLog.plain as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ')
      expect(calls).not.toContain('note')
    })

    it('skips note events with missing or malformed metadata', async () => {
      mockGetOrBuildSessions.mockReturnValue([
        {
          ...SAMPLE_SESSIONS[0],
          events: [{ category: 'note', metadata: '{ bad json' }],
        },
      ])
      await expect(makeProgram().parseAsync(['sessions'], { from: 'user' })).resolves.not.toThrow()
    })
  })

  describe('--date', () => {
    it('passes the specified date to getOrBuildSessions', async () => {
      mockGetOrBuildSessions.mockReturnValue([])
      await makeProgram().parseAsync(['sessions', '--date', '2026-01-15'], { from: 'user' })
      expect(mockGetOrBuildSessions).toHaveBeenCalledWith('2026-01-15')
    })

    it('logs an error and exits on an invalid date', async () => {
      await expect(makeProgram().parseAsync(['sessions', '--date', 'bad-date'], { from: 'user' })).rejects.toThrow()
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Invalid date'))
    })
  })
})

describe('workscribe sessions --json', () => {
  const COMMIT_EVENT = {
    id: 9,
    captured_at: '2026-05-28T09:30:00Z',
    command: 'git commit -m "fix: login redirect"',
    cwd: '/Users/dev/myapp',
    exit_code: 0,
    duration_ms: 80,
    repo_name: 'myapp',
    branch: 'main',
    category: 'shipping',
    metadata: '{"message":"fix: login redirect"}',
    source: 'shell',
    file_path: null,
  }
  const SESSION_WITH_COMMIT = { ...SAMPLE_SESSIONS[0], eventCount: 1, events: [COMMIT_EVENT] }

  function printedJson() {
    const [[printed]] = mockLog.plain.mock.calls
    return JSON.parse(printed as string)
  }

  beforeEach(() => {
    vi.mocked(readConfig).mockReturnValue(createTestConfig())
    vi.mocked(getRepoRoot).mockReturnValue('/Users/dev/myapp')
    vi.mocked(getUserEmail).mockReturnValue('dev@example.com')
    vi.mocked(getCommitsInWindow).mockReturnValue([{ hash: 'a1b2c3d', subject: 'fix: login redirect' }])
    vi.mocked(getOthersSubjects).mockReturnValue([])
  })

  it('prints one line of JSON with the session, its git repo and commits', async () => {
    mockGetOrBuildSessions.mockReturnValue([SESSION_WITH_COMMIT])

    await makeProgram().parseAsync(['sessions', '--json'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledTimes(1)
    const json = printedJson()
    expect(json.schemaVersion).toBe(1)
    expect(json.sessions[0]).toMatchObject({
      key: 'myapp|2026-05-28T09:00:00Z',
      repoPath: '/Users/dev/myapp',
      commits: [{ hash: 'a1b2c3d', subject: 'fix: login redirect', source: 'git' }],
    })
    expect(getCommitsInWindow).toHaveBeenCalledWith({
      repoRoot: '/Users/dev/myapp',
      since: '2026-05-28T09:00:00Z',
      until: '2026-05-28T10:30:00Z',
      author: 'dev@example.com',
    })
    expect(JSON.stringify(json)).not.toContain('git commit -m')
  })

  it('prints an empty list for a day with no sessions', async () => {
    mockGetOrBuildSessions.mockReturnValue([])

    await makeProgram().parseAsync(['sessions', '--json', '--date', '2026-05-28'], { from: 'user' })

    expect(printedJson()).toEqual({ schemaVersion: 1, date: '2026-05-28', sessions: [] })
  })

  it('keeps captured commits when the session is not in a git repo', async () => {
    vi.mocked(getRepoRoot).mockReturnValue(null)
    mockGetOrBuildSessions.mockReturnValue([SESSION_WITH_COMMIT])

    await makeProgram().parseAsync(['sessions', '--json'], { from: 'user' })

    expect(printedJson().sessions[0]).toMatchObject({
      repoPath: null,
      commits: [{ hash: null, subject: 'fix: login redirect', source: 'captured' }],
    })
    expect(getCommitsInWindow).not.toHaveBeenCalled()
  })

  it('still prints captured commits when git returns nothing and no email is configured', async () => {
    vi.mocked(getUserEmail).mockReturnValue(null)
    vi.mocked(getCommitsInWindow).mockReturnValue([])
    mockGetOrBuildSessions.mockReturnValue([SESSION_WITH_COMMIT])

    await makeProgram().parseAsync(['sessions', '--json'], { from: 'user' })

    expect(getCommitsInWindow).toHaveBeenCalledWith(expect.objectContaining({ author: null }))
    expect(printedJson().sessions[0]).toMatchObject({
      repoPath: '/Users/dev/myapp',
      commits: [{ hash: null, subject: 'fix: login redirect', source: 'captured' }],
    })
  })

  it('asks git for the repo root and email once per run, not once per session', async () => {
    mockGetOrBuildSessions.mockReturnValue([SESSION_WITH_COMMIT, { ...SESSION_WITH_COMMIT, id: 3 }])

    await makeProgram().parseAsync(['sessions', '--json'], { from: 'user' })

    expect(getRepoRoot).toHaveBeenCalledTimes(1)
    expect(getUserEmail).toHaveBeenCalledTimes(1)
    expect(getOthersSubjects).toHaveBeenCalledTimes(1)
    expect(getCommitsInWindow).toHaveBeenCalledTimes(2)
  })

  it('drops a captured commit that someone else made, such as one pulled in during an AI session', async () => {
    vi.mocked(getCommitsInWindow).mockReturnValue([])
    vi.mocked(getOthersSubjects).mockReturnValue(['fix: login redirect'])
    mockGetOrBuildSessions.mockReturnValue([SESSION_WITH_COMMIT])

    await makeProgram().parseAsync(['sessions', '--json'], { from: 'user' })

    expect(getOthersSubjects).toHaveBeenCalledWith('/Users/dev/myapp', 'dev@example.com')
    expect(printedJson().sessions[0].commits).toEqual([])
  })

  it('does not look up git for a session without events', async () => {
    mockGetOrBuildSessions.mockReturnValue([SAMPLE_SESSIONS[0]])

    await makeProgram().parseAsync(['sessions', '--json'], { from: 'user' })

    expect(getRepoRoot).not.toHaveBeenCalled()
    expect(printedJson().sessions[0]).toMatchObject({ repoPath: null, cwd: null, commits: [] })
  })
})
