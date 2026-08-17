import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/sessions/detector', () => ({
  getOrBuildSessions: vi.fn(),
}))

import { Command } from 'commander'
import { getOrBuildSessions } from '../../src/sessions/detector'
import { log } from '../../src/utils/logger'
import { registerSessions } from '../../src/cli/sessions'

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
