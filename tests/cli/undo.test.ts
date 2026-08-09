import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/db', () => ({
  getLastEventIds: vi.fn(),
  getEventsByIds: vi.fn(),
  deleteEventsByIds: vi.fn(),
}))

import { Command } from 'commander'
import { getLastEventIds, getEventsByIds, deleteEventsByIds } from '../../src/db'
import { log } from '../../src/utils/logger'
import { registerUndo } from '../../src/cli/undo'

const mockGetLastEventIds = getLastEventIds as ReturnType<typeof vi.fn>
const mockGetEventsByIds = getEventsByIds as ReturnType<typeof vi.fn>
const mockDeleteEventsByIds = deleteEventsByIds as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const SAMPLE_EVENTS = [
  {
    id: 5,
    captured_at: '2026-05-28T10:05:00Z',
    category: 'test_run',
    command: 'npm test',
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 200,
    repo_name: 'myapp',
    branch: 'main',
    metadata: null,
  },
  {
    id: 4,
    captured_at: '2026-05-28T10:00:00Z',
    category: 'code_commit',
    command: 'git commit',
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 100,
    repo_name: 'myapp',
    branch: 'main',
    metadata: null,
  },
]

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerUndo(program)
  return program
}

describe('workscribe undo', () => {
  describe('no events', () => {
    it('logs a message and does not call delete when no events exist', async () => {
      mockGetLastEventIds.mockReturnValue([])
      await makeProgram().parseAsync(['undo'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith('No events to undo.')
      expect(mockDeleteEventsByIds).not.toHaveBeenCalled()
    })
  })

  describe('default (n=1)', () => {
    it('requests the last 1 event', async () => {
      mockGetLastEventIds.mockReturnValue([5])
      mockGetEventsByIds.mockReturnValue([SAMPLE_EVENTS[0]])
      await makeProgram().parseAsync(['undo'], { from: 'user' })
      expect(mockGetLastEventIds).toHaveBeenCalledWith(1)
    })

    it('deletes the returned ids', async () => {
      mockGetLastEventIds.mockReturnValue([5])
      mockGetEventsByIds.mockReturnValue([SAMPLE_EVENTS[0]])
      await makeProgram().parseAsync(['undo'], { from: 'user' })
      expect(mockDeleteEventsByIds).toHaveBeenCalledWith([5])
    })

    it('logs success with singular "event"', async () => {
      mockGetLastEventIds.mockReturnValue([5])
      mockGetEventsByIds.mockReturnValue([SAMPLE_EVENTS[0]])
      await makeProgram().parseAsync(['undo'], { from: 'user' })
      expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('Removed 1 event'))
    })
  })

  describe('--count', () => {
    it('requests the specified number of events', async () => {
      mockGetLastEventIds.mockReturnValue([5, 4])
      mockGetEventsByIds.mockReturnValue(SAMPLE_EVENTS)
      await makeProgram().parseAsync(['undo', '--count', '2'], { from: 'user' })
      expect(mockGetLastEventIds).toHaveBeenCalledWith(2)
    })

    it('deletes all returned ids', async () => {
      mockGetLastEventIds.mockReturnValue([5, 4])
      mockGetEventsByIds.mockReturnValue(SAMPLE_EVENTS)
      await makeProgram().parseAsync(['undo', '--count', '2'], { from: 'user' })
      expect(mockDeleteEventsByIds).toHaveBeenCalledWith([5, 4])
    })

    it('logs success with plural "events" for count > 1', async () => {
      mockGetLastEventIds.mockReturnValue([5, 4])
      mockGetEventsByIds.mockReturnValue(SAMPLE_EVENTS)
      await makeProgram().parseAsync(['undo', '--count', '2'], { from: 'user' })
      expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('Removed 2 events'))
    })

    it('logs an error and exits for non-numeric count', async () => {
      await expect(makeProgram().parseAsync(['undo', '--count', 'abc'], { from: 'user' })).rejects.toThrow()
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('positive integer'))
    })

    it('logs an error and exits for count of 0', async () => {
      await expect(makeProgram().parseAsync(['undo', '--count', '0'], { from: 'user' })).rejects.toThrow()
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('positive integer'))
    })
  })

  describe('--dry-run', () => {
    it('shows events without deleting them', async () => {
      mockGetLastEventIds.mockReturnValue([5, 4])
      mockGetEventsByIds.mockReturnValue(SAMPLE_EVENTS)
      await makeProgram().parseAsync(['undo', '--count', '2', '--dry-run'], { from: 'user' })
      expect(mockDeleteEventsByIds).not.toHaveBeenCalled()
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('Dry run'))
    })

    it('still retrieves and displays the events', async () => {
      mockGetLastEventIds.mockReturnValue([5])
      mockGetEventsByIds.mockReturnValue([SAMPLE_EVENTS[0]])
      await makeProgram().parseAsync(['undo', '--dry-run'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('Events to remove'))
    })
  })
})
