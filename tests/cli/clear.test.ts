import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/db', () => ({
  getEventsForDate: vi.fn(),
  deleteEventsForDate: vi.fn(),
}))

vi.mock('prompts', () => ({ default: vi.fn() }))

import { Command } from 'commander'
import prompts from 'prompts'
import { getEventsForDate, deleteEventsForDate } from '../../src/db'
import { registerClear } from '../../src/cli/clear'

const mockGetEvents = getEventsForDate as ReturnType<typeof vi.fn>
const mockDelete = deleteEventsForDate as ReturnType<typeof vi.fn>
const mockPrompts = prompts as ReturnType<typeof vi.fn>

function makeProgram() {
  const program = new Command()
  program.exitOverride() // prevent process.exit from killing the test runner
  registerClear(program)
  return program
}

const SAMPLE_EVENTS = [
  {
    id: 1,
    category: 'code_commit',
    captured_at: '2026-05-28T10:00:00Z',
    command: 'git commit',
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
    category: 'test_run',
    captured_at: '2026-05-28T10:10:00Z',
    command: 'npm test',
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 180,
    repo_name: 'myapp',
    branch: 'main',
    metadata: null,
  },
]

describe('workscribe clear', () => {
  describe('no events', () => {
    it('logs a message and returns without deleting when no events exist', async () => {
      mockGetEvents.mockReturnValue([])
      await makeProgram().parseAsync(['clear', '--yes'], { from: 'user' })
      expect(mockDelete).not.toHaveBeenCalled()
    })
  })

  describe('--dry-run', () => {
    it('does not call deleteEventsForDate', async () => {
      mockGetEvents.mockReturnValue(SAMPLE_EVENTS)
      await makeProgram().parseAsync(['clear', '--dry-run'], { from: 'user' })
      expect(mockDelete).not.toHaveBeenCalled()
    })

    it('does not prompt for confirmation', async () => {
      mockGetEvents.mockReturnValue(SAMPLE_EVENTS)
      await makeProgram().parseAsync(['clear', '--dry-run'], { from: 'user' })
      expect(mockPrompts).not.toHaveBeenCalled()
    })
  })

  describe('--yes flag', () => {
    it('skips the confirmation prompt and deletes events', async () => {
      mockGetEvents.mockReturnValue(SAMPLE_EVENTS)
      mockDelete.mockReturnValue(3)
      await makeProgram().parseAsync(['clear', '--yes'], { from: 'user' })
      expect(mockPrompts).not.toHaveBeenCalled()
      expect(mockDelete).toHaveBeenCalledOnce()
    })

    it('passes the correct date to deleteEventsForDate', async () => {
      mockGetEvents.mockReturnValue(SAMPLE_EVENTS)
      mockDelete.mockReturnValue(3)
      await makeProgram().parseAsync(['clear', '--yes', '--date', '2026-05-20'], { from: 'user' })
      expect(mockDelete).toHaveBeenCalledWith('2026-05-20')
    })
  })

  describe('interactive confirmation', () => {
    it('deletes events when user confirms', async () => {
      mockGetEvents.mockReturnValue(SAMPLE_EVENTS)
      mockDelete.mockReturnValue(3)
      mockPrompts.mockResolvedValue({ confirm: true })
      await makeProgram().parseAsync(['clear'], { from: 'user' })
      expect(mockDelete).toHaveBeenCalledOnce()
    })

    it('does not delete events when user declines', async () => {
      mockGetEvents.mockReturnValue(SAMPLE_EVENTS)
      mockPrompts.mockResolvedValue({ confirm: false })
      await makeProgram().parseAsync(['clear'], { from: 'user' })
      expect(mockDelete).not.toHaveBeenCalled()
    })
  })

  describe('--date option', () => {
    it('fetches events for the specified date', async () => {
      mockGetEvents.mockReturnValue([])
      await makeProgram().parseAsync(['clear', '--date', '2026-05-20'], { from: 'user' })
      expect(mockGetEvents).toHaveBeenCalledWith('2026-05-20')
    })
  })
})
