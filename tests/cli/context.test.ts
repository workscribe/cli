import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/db', () => ({
  getRecentSessionsByRepo: vi.fn(),
  getLastSessionTouchingFile: vi.fn(),
  getSessionBranch: vi.fn(),
}))

vi.mock('../../src/capture/git', () => ({
  getGitContext: vi.fn(),
}))

import { Command } from 'commander'
import { getRecentSessionsByRepo, getLastSessionTouchingFile, getSessionBranch } from '../../src/db'
import { getGitContext } from '../../src/capture/git'
import { log } from '../../src/utils/logger'
import { registerContext } from '../../src/cli/context'

const mockGetRecentSessionsByRepo = getRecentSessionsByRepo as ReturnType<typeof vi.fn>
const mockGetLastSessionTouchingFile = getLastSessionTouchingFile as ReturnType<typeof vi.fn>
const mockGetSessionBranch = getSessionBranch as ReturnType<typeof vi.fn>
const mockGetGitContext = getGitContext as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const SAMPLE_SESSION = {
  id: 1,
  date: '2026-08-20',
  started_at: '2026-08-20T10:00:00.000Z',
  ended_at: '2026-08-20T12:14:00.000Z',
  repo_name: 'myapp',
  event_count: 42,
  summary: 'Implemented authentication middleware.',
}

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerContext(program)
  return program
}

describe('workscribe context --file', () => {
  describe('--json', () => {
    it('prints a structured object when a session is found', async () => {
      mockGetLastSessionTouchingFile.mockReturnValue(SAMPLE_SESSION)
      mockGetSessionBranch.mockReturnValue('feature/auth')

      await makeProgram().parseAsync(['context', '--file', 'src/auth.ts', '--json'], { from: 'user' })

      const printed = mockLog.plain.mock.calls[0][0] as string
      const parsed = JSON.parse(printed)
      expect(parsed).toMatchObject({
        date: '2026-08-20',
        startedAt: '2026-08-20T10:00:00.000Z',
        endedAt: '2026-08-20T12:14:00.000Z',
        branch: 'feature/auth',
        eventCount: 42,
        summary: 'Implemented authentication middleware.',
      })
      expect(parsed.timeAgo).toEqual(expect.any(String))
      expect(parsed.durationMinutes).toBe(134)
    })

    it('prints null when no session touches the file', async () => {
      mockGetLastSessionTouchingFile.mockReturnValue(undefined)

      await makeProgram().parseAsync(['context', '--file', 'src/never-touched.ts', '--json'], { from: 'user' })

      expect(mockLog.plain).toHaveBeenCalledWith('null')
    })

    it('includes null summary when the session has no cached summary yet', async () => {
      mockGetLastSessionTouchingFile.mockReturnValue({ ...SAMPLE_SESSION, summary: null })
      mockGetSessionBranch.mockReturnValue(null)

      await makeProgram().parseAsync(['context', '--file', 'src/auth.ts', '--json'], { from: 'user' })

      const parsed = JSON.parse(mockLog.plain.mock.calls[0][0] as string)
      expect(parsed.summary).toBeNull()
      expect(parsed.branch).toBeNull()
    })
  })

  describe('without --json (default text output)', () => {
    it('prints a formatted message when no session touches the file', async () => {
      mockGetLastSessionTouchingFile.mockReturnValue(undefined)

      await makeProgram().parseAsync(['context', '--file', 'src/never-touched.ts'], { from: 'user' })

      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('No sessions found touching'))
    })

    it('prints the session heading and summary when a session is found', async () => {
      mockGetLastSessionTouchingFile.mockReturnValue(SAMPLE_SESSION)
      mockGetSessionBranch.mockReturnValue('feature/auth')

      await makeProgram().parseAsync(['context', '--file', 'src/auth.ts'], { from: 'user' })

      const calls = mockLog.plain.mock.calls.map((call: unknown[]) => call[0])
      expect(calls.some((call) => typeof call === 'string' && call.includes('Last session touching'))).toBe(true)
      expect(calls.some((call) => typeof call === 'string' && call.includes(SAMPLE_SESSION.summary))).toBe(true)
    })
  })
})

describe('workscribe context (repo mode)', () => {
  it('prints null with --json when not in a git repository', async () => {
    mockGetGitContext.mockReturnValue({ repoName: null, branch: null })

    await makeProgram().parseAsync(['context', '--json'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith('null')
  })

  it('prints null with --json when no sessions exist for the repo', async () => {
    mockGetGitContext.mockReturnValue({ repoName: 'myapp', branch: 'main' })
    mockGetRecentSessionsByRepo.mockReturnValue([])

    await makeProgram().parseAsync(['context', '--json'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith('null')
  })

  it('prints a structured object with --json when a session exists', async () => {
    mockGetGitContext.mockReturnValue({ repoName: 'myapp', branch: 'main' })
    mockGetRecentSessionsByRepo.mockReturnValue([SAMPLE_SESSION])
    mockGetSessionBranch.mockReturnValue('main')

    await makeProgram().parseAsync(['context', '--json'], { from: 'user' })

    const parsed = JSON.parse(mockLog.plain.mock.calls[0][0] as string)
    expect(parsed.eventCount).toBe(42)
  })
})
