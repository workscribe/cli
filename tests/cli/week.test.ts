import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db', () => ({ updateSessionSummary: vi.fn() }))
vi.mock('../../src/sessions/detector', () => ({ getOrBuildSessions: vi.fn() }))
vi.mock('../../src/ai/router', () => ({ getProvider: vi.fn() }))
vi.mock('../../src/config', () => ({ readConfig: vi.fn() }))
vi.mock('../../src/integrations/webhook', () => ({ postToWebhook: vi.fn() }))
vi.mock('../../src/integrations/slack', () => ({
  formatForSlack: vi.fn((text: string) => text),
  isSlackWebhookUrl: vi.fn(() => false),
}))
vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}))
vi.mock('../../src/utils/paths', () => ({
  WEEKLY_CACHE_DIR: '/home/user/.workscribe/weekly-cache',
}))
vi.mock('../../src/utils/format', () => ({
  todayDate: vi.fn(() => '2026-08-17'),
  startOfWeek: vi.fn(() => '2026-08-17'),
  eachDayOfRange: vi.fn(() => ['2026-08-17']),
  isoWeekKey: vi.fn(() => '2026-W34'),
  formatDate: vi.fn(() => '09:00'),
}))

import { Command } from 'commander'
import fs from 'fs'
import { getOrBuildSessions } from '../../src/sessions/detector'
import { getProvider } from '../../src/ai/router'
import { readConfig } from '../../src/config'
import { postToWebhook } from '../../src/integrations/webhook'
import { isSlackWebhookUrl, formatForSlack } from '../../src/integrations/slack'
import { log } from '../../src/utils/logger'
import { registerWeek } from '../../src/cli/week'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockGetOrBuildSessions = getOrBuildSessions as ReturnType<typeof vi.fn>
const mockGetProvider = getProvider as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockPostToWebhook = postToWebhook as ReturnType<typeof vi.fn>
const mockIsSlackWebhookUrl = isSlackWebhookUrl as ReturnType<typeof vi.fn>
const mockFormatForSlack = formatForSlack as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const FAKE_SESSION = {
  repoName: 'my-app',
  durationMinutes: 60,
  startedAt: '2026-08-17T09:00:00.000Z',
  endedAt: '2026-08-17T10:00:00.000Z',
  events: [
    { category: 'shipping', metadata: '{"message":"fix: bug"}', exit_code: 0, duration_ms: null, branch: 'main' },
  ],
}

const BASE_CONFIG = {
  ai: { provider: 'anthropic' },
  integrations: {},
}

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerWeek(program)
  return program
}

beforeEach(() => {
  vi.clearAllMocks()
  mockReadConfig.mockReturnValue(BASE_CONFIG)
  mockGetOrBuildSessions.mockReturnValue([FAKE_SESSION])
  mockGetProvider.mockReturnValue({ summarizeWeek: vi.fn().mockResolvedValue('# Week summary\n- Shipped a fix') })
  mockFs.existsSync.mockReturnValue(false)
  mockPostToWebhook.mockResolvedValue(undefined)
})

describe('workscribe week', () => {
  it('generates and outputs a weekly summary', async () => {
    await makeProgram().parseAsync(['week'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('Week summary'))
  })

  it('writes the summary to the weekly cache file', async () => {
    await makeProgram().parseAsync(['week'], { from: 'user' })
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('2026-W34.md'),
      expect.stringContaining('Week summary'),
      expect.any(Object)
    )
  })

  it('returns cached content without calling the provider when cache exists', async () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('# Cached week')
    await makeProgram().parseAsync(['week'], { from: 'user' })
    const provider = mockGetProvider.mock.results[0].value
    expect(provider.summarizeWeek).not.toHaveBeenCalled()
    expect(mockLog.plain).toHaveBeenCalledWith('# Cached week')
  })

  it('shows the cached hint when serving from cache', async () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('# Cached week')
    await makeProgram().parseAsync(['week'], { from: 'user' })
    const allOutput = (mockLog.plain as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ')
    expect(allOutput).toContain('--fresh')
  })

  it('bypasses cache and regenerates when --fresh is passed', async () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('# Cached week')
    await makeProgram().parseAsync(['week', '--fresh'], { from: 'user' })
    const provider = mockGetProvider.mock.results[0].value
    expect(provider.summarizeWeek).toHaveBeenCalled()
  })

  it('falls back to provider.summarize when summarizeWeek is not available', async () => {
    const fallback = vi.fn().mockResolvedValue('# Fallback summary')
    mockGetProvider.mockReturnValue({ summarize: fallback })
    await makeProgram().parseAsync(['week'], { from: 'user' })
    expect(fallback).toHaveBeenCalled()
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('Fallback summary'))
  })

  it('shows "No activity" message when there are no sessions this week', async () => {
    mockGetOrBuildSessions.mockReturnValue([])
    await makeProgram().parseAsync(['week'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith('No activity captured this week.')
  })

  it('posts to webhook when --webhook is passed', async () => {
    await makeProgram().parseAsync(['week', '--webhook', 'https://hooks.example.com/abc'], { from: 'user' })
    expect(mockPostToWebhook).toHaveBeenCalledWith('https://hooks.example.com/abc', expect.any(String))
  })

  it('formats for Slack when --slack is passed and webhook is a Slack URL', async () => {
    mockIsSlackWebhookUrl.mockReturnValue(true)
    mockReadConfig.mockReturnValue({
      ...BASE_CONFIG,
      integrations: { slackWebhook: 'https://hooks.slack.com/T123/B456' },
    })
    await makeProgram().parseAsync(['week', '--slack'], { from: 'user' })
    expect(mockFormatForSlack).toHaveBeenCalled()
    expect(mockPostToWebhook).toHaveBeenCalledWith('https://hooks.slack.com/T123/B456', expect.any(String))
  })

  it('warns when --slack is passed but no webhook is configured', async () => {
    await makeProgram().parseAsync(['week', '--slack'], { from: 'user' })
    expect(mockPostToWebhook).not.toHaveBeenCalled()
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('integrations.slackWebhook'))
  })
})
