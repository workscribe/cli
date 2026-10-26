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

vi.mock('../../src/db/alerts', () => ({
  getPendingAlerts: vi.fn().mockReturnValue([]),
}))

vi.mock('../../src/capture/hooks/claude-code', () => ({
  checkHookHealth: vi.fn().mockReturnValue({ installed: false, pinned: true, confirmedBroken: null }),
}))

// fs is mocked above, so the skill modules must be too — by default no coding agents are detected
vi.mock('../../src/skills/detect', () => ({ detectAgents: vi.fn().mockReturnValue([]) }))
vi.mock('../../src/skills/installer', () => ({
  readInstallState: vi.fn(),
  installSkill: vi.fn(),
  uninstallSkill: vi.fn(),
}))

import fs from 'fs'
import { Command } from 'commander'
import { detectAgents } from '../../src/skills/detect'
import { readInstallState } from '../../src/skills/installer'
import { skillAgent as agent } from '../helpers/skill-agents'
import { getEventCount, getLastEvent, getEventsForDate, getRecentOtherRate } from '../../src/db'
import { readConfig } from '../../src/config'
import { log } from '../../src/utils/logger'
import { registerStatus } from '../../src/cli/status'
import { checkHookHealth } from '../../src/capture/hooks/claude-code'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockGetEventCount = getEventCount as ReturnType<typeof vi.fn>
const mockGetLastEvent = getLastEvent as ReturnType<typeof vi.fn>
const mockGetEventsForDate = getEventsForDate as ReturnType<typeof vi.fn>
const mockGetRecentOtherRate = getRecentOtherRate as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>
const mockCheckHookHealth = checkHookHealth as ReturnType<typeof vi.fn>

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
  mockCheckHookHealth.mockReturnValue({ installed: false, pinned: true, confirmedBroken: null })
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

  describe('Claude Code hook health', () => {
    it('shows no warning when no hook is installed', async () => {
      mockCheckHookHealth.mockReturnValue({ installed: false, pinned: true, confirmedBroken: null })
      await makeProgram().parseAsync(['status'], { from: 'user' })
      const calls = (mockLog.plain as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ')
      expect(calls).not.toContain('Claude Code hook')
    })

    it('shows no warning when the installed hook is pinned', async () => {
      mockCheckHookHealth.mockReturnValue({ installed: true, pinned: true, confirmedBroken: null })
      await makeProgram().parseAsync(['status'], { from: 'user' })
      const calls = (mockLog.plain as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ')
      expect(calls).not.toContain('Claude Code hook')
    })

    it('shows a "failing right now" warning when unpinned and confirmed broken', async () => {
      mockCheckHookHealth.mockReturnValue({ installed: true, pinned: false, confirmedBroken: true })
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('is failing right now'))
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('workscribe init'))
    })

    it('shows a softer "can silently break" warning when unpinned but currently working', async () => {
      mockCheckHookHealth.mockReturnValue({ installed: true, pinned: false, confirmedBroken: false })
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('can silently break'))
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('workscribe init'))
    })
  })

  describe('summaries and old AI settings', () => {
    const configWithoutAi = () => {
      const { ai: _removedAi, ...rest } = BASE_CONFIG
      return rest
    }

    it('says summaries use the offline template', async () => {
      mockReadConfig.mockReturnValue(configWithoutAi())
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringMatching(/Summaries\s+.*template.*\(offline\)/))
    })

    it('prints the 2.0 notice once for a 1.x config with AI provider settings', async () => {
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.notice).toHaveBeenCalledTimes(1)
      expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('  workscribe init'))
    })

    it('prints no notice when no old AI settings are left', async () => {
      mockReadConfig.mockReturnValue(configWithoutAi())
      await makeProgram().parseAsync(['status'], { from: 'user' })
      expect(mockLog.notice).not.toHaveBeenCalled()
    })
  })
})

describe('workscribe status — agent skill', () => {
  const skillLines = () =>
    mockLog.plain.mock.calls
      .map(([line]: unknown[]) => String(line))
      .filter((line) => line.includes('~/.claude/skills') || line.includes('~/.cursor/skills'))

  it('shows one line per detected agent with its state and the fix', async () => {
    vi.mocked(detectAgents).mockReturnValue([agent('claude-code'), agent('cursor')])
    vi.mocked(readInstallState).mockImplementation((folder: string) =>
      folder.endsWith('.claude/skills') ? { kind: 'installed', version: '0.0.0-test' } : { kind: 'not-installed' }
    )

    await makeProgram().parseAsync(['status'], { from: 'user' })

    const lines = skillLines()
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/Agent skill\s+Claude Code.*installed \(0\.0\.0-test\)/)
    expect(lines[1]).toMatch(/^\s+Cursor.*not installed — run workscribe skill install/)
  })

  it('shows nothing about skills when no coding agents are detected', async () => {
    vi.mocked(detectAgents).mockReturnValue([])

    await makeProgram().parseAsync(['status'], { from: 'user' })

    expect(skillLines()).toEqual([])
  })
})
