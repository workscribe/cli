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
vi.mock('../../src/summary/day-commits', () => ({
  DAY_GIT_BUDGET_MS: 3000,
  lookupDayCommits: vi.fn((windows: unknown[]) => windows.map(() => null)),
}))
vi.mock('../../src/utils/format', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/utils/format')>()),
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
import { lookupDayCommits } from '../../src/summary/day-commits'
import { eachDayOfRange } from '../../src/utils/format'

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

  it('lays the week out by project by default, and by day with --by day', async () => {
    const summarizeWeek = vi.fn().mockResolvedValue('# Week')
    mockCreateSummaryWriter.mockReturnValue({ summarizeWeek })

    await makeProgram().parseAsync(['week'], { from: 'user' })
    await makeProgram().parseAsync(['week', '--by', 'day'], { from: 'user' })

    expect(summarizeWeek.mock.calls.map(([payload]) => payload.by)).toEqual(['project', 'day'])
  })

  it('refuses a layout it does not know', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit')
    }) as never)
    onTestFinished(() => exitSpy.mockRestore())

    await expect(makeProgram().parseAsync(['week', '--by', 'month'], { from: 'user' })).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith('--by must be project or day')
  })

  it("asks git once for the whole week's threads, within the week's budget", async () => {
    await makeProgram().parseAsync(['week'], { from: 'user' })

    expect(lookupDayCommits).toHaveBeenCalledOnce()
    expect(lookupDayCommits).toHaveBeenCalledWith([expect.objectContaining({ cwd: '/Users/dev/api' })], {
      budgetMs: 3000,
    })
  })

  it.each(['project', 'day'])('prints only plain text with --format text, laid out by %s', async (layout) => {
    await makeProgram().parseAsync(['week', '--by', layout, '--format', 'text'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledTimes(1)
    expect(mockLog.plain).toHaveBeenCalledWith('Week summary\n- Shipped a fix')
  })

  it('prints plain text when summary.format is text, and --format markdown overrides it', async () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, summary: { format: 'text' } })

    await makeProgram().parseAsync(['week'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith('Week summary\n- Shipped a fix')

    mockLog.plain.mockClear()

    await makeProgram().parseAsync(['week', '--format', 'markdown'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith('# Week summary\n- Shipped a fix')
  })

  it('still posts the markdown in text mode, with its status on stderr', async () => {
    await makeProgram().parseAsync(['week', '--format', 'text', '--webhook', 'https://hooks.example.com/abc'], {
      from: 'user',
    })

    expect(mockPostToWebhook).toHaveBeenCalledWith('https://hooks.example.com/abc', '# Week summary\n- Shipped a fix')
    expect(mockLog.plain).toHaveBeenCalledTimes(1)
    expect(mockLog.notice).toHaveBeenCalledWith('Posted.')
  })

  it('rejects an unknown --format before reading anything', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit')
    })
    onTestFinished(() => exitSpy.mockRestore())

    await expect(makeProgram().parseAsync(['week', '--format', 'xml'], { from: 'user' })).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith('--format must be markdown, json or text')
    expect(requireThreadData).not.toHaveBeenCalled()
  })

  it('prints the week as one JSON document with summary.format json, and still posts the text', async () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, summary: { format: 'json' } })
    mockCreateSummaryWriter.mockReturnValue({ summarizeWeek: vi.fn().mockResolvedValue('# Week summary') })

    await makeProgram().parseAsync(['week', '--webhook', 'https://hooks.example.com/abc'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledTimes(1)
    const json = JSON.parse(mockLog.plain.mock.calls[0][0] as string)
    expect(json).toMatchObject({ weekStart: '2026-08-17', weekEnd: '2026-08-17', by: 'project' })
    expect(json.projects[0]).toMatchObject({
      project: 'my-app',
      branches: [expect.objectContaining({ branch: 'main' })],
    })
    expect(mockPostToWebhook).toHaveBeenCalledWith('https://hooks.example.com/abc', '# Week summary')
  })

  it("gives each thread of the week git's commits for its own window, across days and blocks", async () => {
    const summarizeWeek = vi.fn().mockResolvedValue('# Week')
    mockCreateSummaryWriter.mockReturnValue({ summarizeWeek })
    vi.mocked(eachDayOfRange).mockReturnValue(['2026-08-17', '2026-08-18'])
    const threadAt = (startedAt: string, repoName: string) =>
      thread([row({ captured_at: startedAt, repo_name: repoName, cwd: `/Users/dev/${repoName}`, branch: 'main' })], {
        repoName,
        startedAt,
        endedAt: startedAt,
      })
    const monday = threadAt('2026-08-17T09:00:00.000Z', 'api')
    const tuesdayApi = threadAt('2026-08-18T09:00:00.000Z', 'api')
    const tuesdayWeb = threadAt('2026-08-18T14:00:00.000Z', 'web')
    vi.mocked(loadDayThreads).mockImplementation((date: string) =>
      date === '2026-08-17'
        ? [block([monday], { date })]
        : [block([tuesdayApi], { date }), block([tuesdayWeb], { id: 2, date })]
    )
    const gitCommit = (subject: string, committedAt: string) => ({ hash: subject, subject, committedAt })
    vi.mocked(lookupDayCommits).mockReturnValueOnce([
      [gitCommit('fix: monday', '2026-08-17T09:00:00.000Z')],
      [gitCommit('fix: tuesday api', '2026-08-18T09:00:00.000Z')],
      [gitCommit('fix: tuesday web', '2026-08-18T14:00:00.000Z')],
    ])

    await makeProgram().parseAsync(['week'], { from: 'user' })

    expect(lookupDayCommits).toHaveBeenCalledOnce()
    const { days } = summarizeWeek.mock.calls[0][0]
    const subjectsOf = (day: { sessions: { commits: { subject: string }[] }[] }) =>
      day.sessions.map((session) => session.commits.map((commit) => commit.subject))
    expect(days.map((day: { date: string }) => day.date)).toEqual(['2026-08-17', '2026-08-18'])
    expect(subjectsOf(days[0])).toEqual([['fix: monday']])
    expect(subjectsOf(days[1])).toEqual([['fix: tuesday api'], ['fix: tuesday web']])
  })
})
