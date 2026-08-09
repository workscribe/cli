import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/db', () => ({
  getEventsForDate: vi.fn(),
}))

vi.mock('../../src/config/registry', () => ({
  loadAIToolRegistry: vi.fn().mockReturnValue([]),
}))

import { Command } from 'commander'
import { getEventsForDate } from '../../src/db'
import { log } from '../../src/utils/logger'
import { registerEvents } from '../../src/cli/events'

const mockGetEvents = getEventsForDate as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const SAMPLE_EVENTS = [
  {
    id: 1,
    category: 'code_commit',
    captured_at: '2026-05-28T10:00:00Z',
    command: 'git commit -m "init"',
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 100,
    repo_name: 'myapp',
    branch: 'main',
    metadata: null,
  },
  {
    id: 2,
    category: 'test_run',
    captured_at: '2026-05-28T10:05:00Z',
    command: 'npm test',
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 200,
    repo_name: 'myapp',
    branch: 'main',
    metadata: null,
  },
  {
    id: 3,
    category: 'build',
    captured_at: '2026-05-28T10:10:00Z',
    command: 'npm run build',
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 150,
    repo_name: 'myapp',
    branch: 'main',
    metadata: null,
  },
]

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerEvents(program)
  return program
}

describe('workscribe events', () => {
  describe('no events', () => {
    it('logs a no-events message', async () => {
      mockGetEvents.mockReturnValue([])
      await makeProgram().parseAsync(['events'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('No events captured'))
    })
  })

  describe('with events', () => {
    it('logs a header with total count', async () => {
      mockGetEvents.mockReturnValue(SAMPLE_EVENTS)
      await makeProgram().parseAsync(['events'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('3 total'))
    })

    it('logs one line per event by default', async () => {
      mockGetEvents.mockReturnValue(SAMPLE_EVENTS)
      await makeProgram().parseAsync(['events'], { from: 'user' })
      expect(mockLog.plain.mock.calls.length).toBeGreaterThanOrEqual(5)
    })
  })

  describe('--limit', () => {
    it('truncates to the specified limit and shows overflow message', async () => {
      mockGetEvents.mockReturnValue(SAMPLE_EVENTS)
      await makeProgram().parseAsync(['events', '--limit', '1'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('and 2 more'))
    })

    it('does not show overflow message when limit equals total', async () => {
      mockGetEvents.mockReturnValue(SAMPLE_EVENTS)
      await makeProgram().parseAsync(['events', '--limit', '3'], { from: 'user' })
      const calls = mockLog.plain.mock.calls.map((call: unknown[]) => call[0])
      expect(calls.some((call) => typeof call === 'string' && call.includes('more'))).toBe(false)
    })
  })

  describe('--date', () => {
    it('passes the specified date to getEventsForDate', async () => {
      mockGetEvents.mockReturnValue([])
      await makeProgram().parseAsync(['events', '--date', '2026-01-15'], { from: 'user' })
      expect(mockGetEvents).toHaveBeenCalledWith('2026-01-15')
    })

    it('logs an error and exits on an invalid date', async () => {
      await expect(makeProgram().parseAsync(['events', '--date', 'not-a-date'], { from: 'user' })).rejects.toThrow()
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Invalid date'))
    })
  })

  describe('ai_session category', () => {
    it('renders AI session events without throwing', async () => {
      const aiEvent = {
        ...SAMPLE_EVENTS[0],
        category: 'ai_session',
        command: '',
        metadata: JSON.stringify({ tool: 'claude' }),
      }
      mockGetEvents.mockReturnValue([aiEvent])
      await makeProgram().parseAsync(['events'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('1 total'))
    })
  })
})
