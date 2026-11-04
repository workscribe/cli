import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'

vi.mock('../../src/db', () => ({}))
vi.mock('../../src/cli/thread-day', () => ({ requireThreadData: vi.fn(), loadDayThreads: vi.fn() }))
vi.mock('../../src/summary/writer', () => ({ createSummaryWriter: vi.fn() }))
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
vi.mock('../../src/utils/paths')
vi.mock('../../src/utils/format', () => ({
  todayDate: vi.fn(() => '2026-08-17'),
  startOfWeek: vi.fn(() => '2026-08-17'),
  eachDayOfRange: vi.fn(() => ['2026-08-17']),
  formatDate: vi.fn(() => '09:00'),
}))

import { Command } from 'commander'
import fs from 'fs'
import { loadDayThreads, requireThreadData } from '../../src/cli/thread-day'
import { block, row, thread } from '../summary/contract/fixtures'
import { createSummaryWriter } from '../../src/summary/writer'
import { readConfig } from '../../src/config'
import { postToWebhook } from '../../src/integrations/webhook'
import { isSlackWebhookUrl, formatForSlack } from '../../src/integrations/slack'
import { log } from '../../src/utils/logger'
import { registerWeek } from '../../src/cli/week'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockCreateSummaryWriter = createSummaryWriter as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockPostToWebhook = postToWebhook as ReturnType<typeof vi.fn>
const mockIsSlackWebhookUrl = isSlackWebhookUrl as ReturnType<typeof vi.fn>
const mockFormatForSlack = formatForSlack as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const MY_APP = thread(
  [row({ category: 'shipping', metadata: '{"message":"fix: bug"}', repo_name: 'my-app', branch: 'main' })],
  { repoName: 'my-app', startedAt: '2026-08-17T09:00:00.000Z', endedAt: '2026-08-17T10:00:00.000Z' }
)
const DAY = [block([MY_APP], { date: '2026-08-17' })]

const BASE_CONFIG = {
  integrations: {},
}

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerWeek(program)
  return program
}

beforeEach(() => {
  mockReadConfig.mockReturnValue(BASE_CONFIG)
  vi.mocked(loadDayThreads).mockReturnValue(DAY)
  mockCreateSummaryWriter.mockReturnValue({
    summarizeWeek: vi.fn().mockResolvedValue('# Week summary\n- Shipped a fix'),
  })
  mockFs.existsSync.mockReturnValue(false)
  mockPostToWebhook.mockResolvedValue(undefined)
})

describe('workscribe week', () => {
  it('generates and outputs a weekly summary', async () => {
    await makeProgram().parseAsync(['week'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('Week summary'))
  })

  it('renders the digest fresh every time, never reading or writing a weekly cache', async () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('# Cached 1.x digest')

    await makeProgram().parseAsync(['week'], { from: 'user' })

    expect(mockFs.readFileSync).not.toHaveBeenCalled()
    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('Week summary'))
  })

  it('still accepts --fresh from 1.x scripts', async () => {
    await makeProgram().parseAsync(['week', '--fresh'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('Week summary'))
  })

  it('logs the error and exits when the digest fails', async () => {
    mockCreateSummaryWriter.mockReturnValue({ summarizeWeek: vi.fn().mockRejectedValue(new Error('disk full')) })

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    onTestFinished(() => exitSpy.mockRestore())

    await makeProgram().parseAsync(['week'], { from: 'user' })

    expect(mockLog.error).toHaveBeenCalledWith('disk full')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('falls back to provider.summarize when summarizeWeek is not available', async () => {
    const fallback = vi.fn().mockResolvedValue('# Fallback summary')
    mockCreateSummaryWriter.mockReturnValue({ summarize: fallback })
    await makeProgram().parseAsync(['week'], { from: 'user' })
    expect(fallback).toHaveBeenCalled()
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('Fallback summary'))
  })

  it('reads each day of the week from its threads and hands the digest a payload per thread', async () => {
    const summarizeWeek = vi.fn().mockResolvedValue('# Week summary')
    mockCreateSummaryWriter.mockReturnValue({ summarizeWeek })

    await makeProgram().parseAsync(['week'], { from: 'user' })

    expect(loadDayThreads).toHaveBeenCalledWith('2026-08-17')
    const [[payload]] = summarizeWeek.mock.calls
    expect(payload.days).toHaveLength(1)
    expect(payload.days[0]).toMatchObject({ date: '2026-08-17', sessions: [{ project: 'my-app', branch: 'main' }] })
  })

  it("stops before reading the week while the data upgrade isn't finished", async () => {
    vi.mocked(requireThreadData).mockImplementationOnce(() => {
      throw new Error('exit')
    })

    await expect(makeProgram().parseAsync(['week'], { from: 'user' })).rejects.toThrow('exit')

    expect(loadDayThreads).not.toHaveBeenCalled()
  })

  it('shows "No activity" message when there are no threads this week', async () => {
    vi.mocked(loadDayThreads).mockReturnValue([])
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

  it('prints the 2.0 notice once for a 1.x config with AI provider settings', async () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, summary: { engine: 'ollama' } })

    await makeProgram().parseAsync(['week'], { from: 'user' })

    expect(mockLog.notice).toHaveBeenCalledTimes(1)
  })

  it('prints no notice for a 2.0 config', async () => {
    await makeProgram().parseAsync(['week'], { from: 'user' })

    expect(mockLog.notice).not.toHaveBeenCalled()
  })
})
