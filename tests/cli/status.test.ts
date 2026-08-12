import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db', () => ({
  getEventCount: vi.fn(),
  getLastEvent: vi.fn(),
  getEventsForDate: vi.fn(),
  getRecentOtherRate: vi.fn(),
}))

vi.mock('../../src/config', () => ({
  readConfig: vi.fn(),
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
  },
}))

vi.mock('../../src/utils/paths')

import fs from 'fs'
import { Command } from 'commander'
import { getEventCount, getLastEvent, getEventsForDate, getRecentOtherRate } from '../../src/db'
import { readConfig } from '../../src/config'
import { log } from '../../src/utils/logger'
import { registerStatus } from '../../src/cli/status'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockGetEventCount = getEventCount as ReturnType<typeof vi.fn>
const mockGetLastEvent = getLastEvent as ReturnType<typeof vi.fn>
const mockGetEventsForDate = getEventsForDate as ReturnType<typeof vi.fn>
const mockGetRecentOtherRate = getRecentOtherRate as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const BASE_CONFIG = {
  ai: { provider: 'anthropic', apiKey: 'sk-test', model: null },
  session: { idleTimeout: 30 },
  capture: { profiles: [] },
}

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerStatus(program)
  return program
}

beforeEach(() => {
  mockGetEventCount.mockReturnValue(42)
  mockGetEventsForDate.mockReturnValue([])
  mockGetLastEvent.mockReturnValue(undefined)
  mockGetRecentOtherRate.mockReturnValue({ total: 100, otherCount: 10 })
  mockReadConfig.mockReturnValue(BASE_CONFIG)
  mockFs.existsSync.mockReturnValue(false)
})

describe('workscribe status', () => {
  describe('capture state', () => {
    it('shows "active" when pause flag does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false)
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('active'))
    })

    it('shows "paused" when pause flag exists', async () => {
      mockFs.existsSync.mockReturnValue(true)
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('paused'))
    })
  })

  describe('event counts', () => {
    it('shows total event count', async () => {
      mockGetEventCount.mockReturnValue(99)
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('99'))
    })

    it('shows today event count', async () => {
      mockGetEventsForDate.mockReturnValue([{}, {}])
      await makeProgram().parseAsync(['status'], { from: 'user' })
      const calls = mockLog.plain.mock.calls.map((call: unknown[]) => call[0] as string)
      expect(calls.some((call) => call.includes('2'))).toBe(true)
    })
  })

  describe('last event', () => {
    it('shows last event line when a last event exists', async () => {
      mockGetLastEvent.mockReturnValue({
        id: 1,
        captured_at: '2026-05-28T10:00:00Z',
        command: 'git status',
        category: 'versioning',
        cwd: '/repo',
        exit_code: 0,
        duration_ms: 50,
        repo_name: null,
        branch: null,
        metadata: null,
      })
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('git status'))
    })

    it('omits last event line when no events have been captured', async () => {
      mockGetLastEvent.mockReturnValue(undefined)
      await makeProgram().parseAsync(['status'], { from: 'user' })
      const calls = mockLog.plain.mock.calls.map((call: unknown[]) => call[0] as string)
      expect(calls.some((call) => call.includes('Last event'))).toBe(false)
    })
  })

  describe('profiles', () => {
    it('shows active profiles when configured', async () => {
      mockReadConfig.mockReturnValue({ ...BASE_CONFIG, capture: { profiles: ['flutter', 'android'] } })
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('flutter'))
    })

    it('shows "none" when no profiles are active', async () => {
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('none'))
    })
  })

  describe('other event rate hint', () => {
    it('shows a hint when other events exceed 25% of total', async () => {
      mockGetRecentOtherRate.mockReturnValue({ total: 100, otherCount: 30 })
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('30%'))
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('workscribe profile'))
    })

    it('does not show a hint when other events are below 25%', async () => {
      mockGetRecentOtherRate.mockReturnValue({ total: 100, otherCount: 20 })
      await makeProgram().parseAsync(['status'], { from: 'user' })
      const calls = (mockLog.plain as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ')
      expect(calls).not.toContain('uncategorised')
    })

    it('does not show a hint when there are no events', async () => {
      mockGetRecentOtherRate.mockReturnValue({ total: 0, otherCount: 0 })
      await makeProgram().parseAsync(['status'], { from: 'user' })
      const calls = (mockLog.plain as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ')
      expect(calls).not.toContain('uncategorised')
    })
  })

  describe('AI provider', () => {
    it('shows configured provider name', async () => {
      mockReadConfig.mockReturnValue({ ...BASE_CONFIG, ai: { ...BASE_CONFIG.ai, provider: 'openai' } })
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('openai'))
    })

    it('shows "not configured" when provider is absent', async () => {
      mockReadConfig.mockReturnValue({ ...BASE_CONFIG, ai: { provider: null, apiKey: null, model: null } })
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('not configured'))
    })

    it('shows model when configured', async () => {
      mockReadConfig.mockReturnValue({ ...BASE_CONFIG, ai: { ...BASE_CONFIG.ai, model: 'gpt-4o' } })
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('gpt-4o'))
    })
  })
})
