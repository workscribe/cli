import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'

// summary.ts imports from '../db' and '../sessions/detector', both of which
// transitively load node:sqlite (Node 22+ only). Mock them before importing
// the module under test so the import chain never reaches node:sqlite.
vi.mock('../../src/db', () => ({
  getSessionSummaries: vi.fn(() => []),
  saveThreadSummary: vi.fn(),
}))

vi.mock('../../src/cli/thread-day', () => ({
  requireThreadData: vi.fn(),
  loadDayThreads: vi.fn(),
}))

vi.mock('../../src/sessions/detector', () => ({
  getOrBuildSessions: vi.fn(),
}))

vi.mock('../../src/summary/writer', () => ({
  createSummaryWriter: vi.fn(),
}))

vi.mock('../../src/config', () => ({
  readConfig: vi.fn(),
}))

vi.mock('../../src/integrations/webhook', () => ({
  postToWebhook: vi.fn(),
}))

vi.mock('../../src/integrations/slack', () => ({
  formatForSlack: vi.fn(),
  isSlackWebhookUrl: vi.fn(),
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
  parseDate: vi.fn((value: string) => value),
  formatDate: vi.fn(() => '09:00'),
  formatDuration: vi.fn(() => '1h'),
  startOfWeek: vi.fn(() => '2026-08-17'),
  eachDayOfRange: vi.fn(() => ['2026-08-17']),
}))

vi.mock('../../src/summary/day-commits', () => ({
  DAY_GIT_BUDGET_MS: 3000,
  lookupDayCommits: vi.fn((windows: unknown[]) => windows.map(() => [])),
}))

vi.mock('../../src/summary/exclusions', () => ({
  buildExcludedSet: vi.fn(() => new Set()),
  countExcludedEvents: vi.fn(() => new Map()),
}))

import { Command } from 'commander'
import fs from 'fs'
import { getOrBuildSessions } from '../../src/sessions/detector'
import { createSummaryWriter } from '../../src/summary/writer'
import { readConfig } from '../../src/config'
import { saveThreadSummary } from '../../src/db'
import { loadDayThreads, requireThreadData } from '../../src/cli/thread-day'
import { postToWebhook } from '../../src/integrations/webhook'
import { isSlackWebhookUrl } from '../../src/integrations/slack'
import { log } from '../../src/utils/logger'
import { parseBullets, registerSummary } from '../../src/cli/summary'
import { lookupDayCommits } from '../../src/summary/day-commits'
import { formatSessionHeading } from '../../src/summary/heading'
import type { DaySummaryPayload } from '../../src/ai/types'
import type { SummaryRow } from '../../src/db/summary-store'
import { block, row, thread } from '../summary/contract/fixtures'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockGetOrBuildSessions = getOrBuildSessions as ReturnType<typeof vi.fn>
const mockCreateSummaryWriter = createSummaryWriter as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockSaveThreadSummary = saveThreadSummary as ReturnType<typeof vi.fn>
const mockPostToWebhook = postToWebhook as ReturnType<typeof vi.fn>
const mockIsSlackWebhookUrl = isSlackWebhookUrl as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const FAKE_SESSION = {
  repoName: 'my-app',
  durationMinutes: 60,
  startedAt: '2026-08-17T09:00:00.000Z',
  endedAt: '2026-08-17T10:00:00.000Z',
  summary: null,
  events: [
    {
      category: 'shipping',
      metadata: '{"message":"fix: bug"}',
      exit_code: 0,
      duration_ms: null,
      branch: 'main',
      captured_at: '2026-08-17T09:00:00.000Z',
    },
  ],
}

const BASE_CONFIG = { integrations: {} }

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerSummary(program)
  return program
}

describe('parseBullets', () => {
  it('parses - prefixed bullets', () => {
    const text = '- Resolved failing tests\n- Committed authentication fixes'
    expect(parseBullets(text)).toEqual(['Resolved failing tests', 'Committed authentication fixes'])
  })

  it('parses • prefixed bullets (Slack-formatted)', () => {
    const text = '• Added authentication dependencies\n• Pushed to remote'
    expect(parseBullets(text)).toEqual(['Added authentication dependencies', 'Pushed to remote'])
  })

  it('filters empty lines', () => {
    expect(parseBullets('- First bullet\n\n- Second bullet\n')).toEqual(['First bullet', 'Second bullet'])
  })

  it('handles a single bullet', () => {
    expect(parseBullets('- Only one thing done today')).toEqual(['Only one thing done today'])
  })

  it('returns empty array for empty string', () => {
    expect(parseBullets('')).toEqual([])
  })

  it('returns empty array for whitespace only', () => {
    expect(parseBullets('   \n  \n')).toEqual([])
  })

  it('trims whitespace from bullet text', () => {
    expect(parseBullets('-   Extra spaces   ')).toEqual(['Extra spaces'])
  })
})

describe('workscribe summary --week', () => {
  beforeEach(() => {
    mockReadConfig.mockReturnValue(BASE_CONFIG)
    mockGetOrBuildSessions.mockReturnValue([FAKE_SESSION])
    mockCreateSummaryWriter.mockReturnValue({
      summarizeWeek: vi.fn().mockResolvedValue('# Week summary\n- Shipped a fix'),
    })
    mockFs.existsSync.mockReturnValue(false)
  })

  it('generates and outputs a weekly summary', async () => {
    await makeProgram().parseAsync(['summary', '--week'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('Week summary'))
  })

  it('exits with the error when the weekly digest fails', async () => {
    mockCreateSummaryWriter.mockReturnValue({ summarizeWeek: vi.fn().mockRejectedValue(new Error('disk full')) })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    onTestFinished(() => exitSpy.mockRestore())

    await makeProgram().parseAsync(['summary', '--week'], { from: 'user' })

    expect(mockLog.error).toHaveBeenCalledWith('disk full')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('renders the digest fresh every time and writes no weekly cache', async () => {
    await makeProgram().parseAsync(['summary', '--week'], { from: 'user' })

    expect(mockFs.readFileSync).not.toHaveBeenCalled()
    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
  })
})

describe('workscribe summary (daily)', () => {
  const SHIPPING_EVENT = row({
    id: 1,
    category: 'shipping',
    command: 'git commit -m "fix: bug"',
    metadata: '{"message":"fix: bug"}',
    exit_code: 0,
    duration_ms: null,
    branch: 'main',
    captured_at: '2026-08-17T09:00:00.000Z',
    cwd: '/Users/dev/my-app',
    repo_name: 'my-app',
  })
  const OTHER_EVENT = row({
    id: 1,
    category: 'other',
    metadata: '{"hint":"make deploy","tool":"make","target":"deploy"}',
    exit_code: 0,
    duration_ms: 1200,
    branch: 'main',
    captured_at: '2026-08-17T09:30:00.000Z',
  })
  const MY_APP = thread([SHIPPING_EVENT], {
    id: 1,
    projectId: 4,
    repoName: 'my-app',
    key: 'my-app|2026-08-17T09:00:00.000Z',
    startedAt: '2026-08-17T09:00:00.000Z',
    endedAt: '2026-08-17T10:00:00.000Z',
  })
  const API = thread([{ ...SHIPPING_EVENT, id: 2, cwd: '/Users/dev/api', repo_name: 'api' }], {
    id: 2,
    projectId: 5,
    repoName: 'api',
    key: 'api|2026-08-17T09:00:00.000Z',
    startedAt: '2026-08-17T09:00:00.000Z',
    endedAt: '2026-08-17T10:00:00.000Z',
  })

  /** A stored summary anchored to the my-app thread. */
  function savedRow(engine: string, text: string): SummaryRow {
    return {
      id: 1,
      scope: 'session',
      project_id: 4,
      first_event_id: 1,
      last_event_id: 1,
      engine: engine as SummaryRow['engine'],
      text,
      created_at: '2026-08-17T10:00:00.000Z',
      source_key: MY_APP.key,
      origin: 'saved',
      anchor_source: 'thread',
      is_mixed: 0,
    }
  }

  /** Each thread in a block of its own, unless `together`. */
  function dayOf(threads = [MY_APP], { summaries = [] as SummaryRow[], together = false } = {}) {
    const blocks = together
      ? [block(threads, { date: '2026-08-17', summaries })]
      : threads.map((member, index) =>
          block([member], { id: index + 1, date: '2026-08-17', summaries: index === 0 ? summaries : [] })
        )
    vi.mocked(loadDayThreads).mockReturnValue(blocks)
  }

  // The writer returns each thread's finished story, heading included
  function mockSummarize(bullets = '- Shipped a fix') {
    const summarize = vi.fn(
      async (payload: DaySummaryPayload) => `${formatSessionHeading(payload.sessions[0])}\n${bullets}`
    )
    mockCreateSummaryWriter.mockReturnValue({ summarize })
    return summarize
  }

  beforeEach(() => {
    mockReadConfig.mockReturnValue(BASE_CONFIG)
    dayOf()
  })

  it('summarizes each thread separately and saves nothing', async () => {
    dayOf([MY_APP, API])
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(loadDayThreads).toHaveBeenCalledWith('2026-08-17')
    expect(summarize).toHaveBeenCalledTimes(2)
    expect(summarize.mock.calls.map(([payload]) => payload.sessions.map((session) => session.project))).toEqual([
      ['my-app'],
      ['api'],
    ])
    expect(summarize).toHaveBeenNthCalledWith(1, {
      date: '2026-08-17',
      sessions: [
        {
          date: '2026-08-17',
          project: 'my-app',
          branch: 'main',
          branches: ['main'],
          startTime: '09:00',
          endTime: '09:00',
          durationMinutes: 60,
          activeMinutes: 30,
          alongside: [],
          events: [
            {
              category: 'shipping',
              metadata: { message: 'fix: bug' },
              exitCode: 0,
              durationMs: null,
              branch: 'main',
              capturedAt: '2026-08-17T09:00:00.000Z',
              source: 'shell',
            },
          ],
          commits: [{ hash: null, subject: 'fix: bug', committedAt: '2026-08-17T09:00:00.000Z', branch: 'main' }],
        },
      ],
    })
    expect(mockSaveThreadSummary).not.toHaveBeenCalled()
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('## my-app (main) — 1h'))
  })

  it('names the projects worked alongside under each section, and ends with the time worked', async () => {
    dayOf([MY_APP, API], { together: true })
    mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith(
      [
        '## my-app (main) — 1h\n- Shipped a fix\nAlongside: api',
        '## api (main) — 1h\n- Shipped a fix\nAlongside: my-app',
        'Time worked: 1h',
      ].join('\n\n')
    )
  })

  it('says there was no activity for a day with no blocks', async () => {
    vi.mocked(loadDayThreads).mockReturnValue([])
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith('No activity captured for 2026-08-17')
    expect(summarize).not.toHaveBeenCalled()
  })

  it("stops before reading the day while the data upgrade isn't finished", async () => {
    vi.mocked(requireThreadData).mockImplementationOnce(() => {
      throw new Error('exit')
    })
    mockSummarize()

    await expect(makeProgram().parseAsync(['summary'], { from: 'user' })).rejects.toThrow('exit')

    expect(loadDayThreads).not.toHaveBeenCalled()
  })

  it('lifts the hint out of other events and strips hint/tool from metadata', async () => {
    dayOf([{ ...MY_APP, events: [OTHER_EVENT] }])
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    const [event] = summarize.mock.calls[0][0].sessions[0].events
    expect(event).toEqual({
      category: 'other',
      hint: 'make deploy',
      metadata: { target: 'deploy' },
      exitCode: 0,
      durationMs: 1200,
      branch: 'main',
      capturedAt: '2026-08-17T09:30:00.000Z',
      source: 'shell',
    })
  })

  it('still shows a summary a 1.x AI provider wrote for the thread, and says where it came from', async () => {
    dayOf([MY_APP], { summaries: [savedRow('provider', '## my-app — 1h\n- Cached work')] })
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(summarize).not.toHaveBeenCalled()
    expect(mockLog.plain).toHaveBeenCalledWith('## my-app — 1h\n- Cached work\n\nTime worked: 1h')
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('1 written by an AI provider in Workscribe 1.x'))
  })

  it('renders the template instead of a 1.x summary when --fresh is passed', async () => {
    dayOf([MY_APP], { summaries: [savedRow('provider', '## my-app — 1h\n- Cached work')] })
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary', '--fresh'], { from: 'user' })

    expect(summarize).toHaveBeenCalledTimes(1)
  })

  it('prints JSON when summary.format is json, with active time and the projects alongside', async () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, summary: { format: 'json' } })
    mockSummarize('- First thing\n- Second thing')

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    const expected = {
      date: '2026-08-17',
      activeMinutes: 40,
      sessions: [
        {
          project: 'my-app',
          branch: 'main',
          durationMinutes: 60,
          activeMinutes: 30,
          alongside: [],
          bullets: ['First thing', 'Second thing'],
        },
      ],
    }
    expect(mockLog.plain).toHaveBeenCalledWith(JSON.stringify(expected, null, 2))
  })

  it('keeps the alongside and time-worked lines out of the JSON bullets', async () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, summary: { format: 'json' } })
    dayOf([MY_APP, API], { together: true })
    mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    const json = JSON.parse(mockLog.plain.mock.calls[0][0])
    expect(json.sessions.map((session: { alongside: string[] }) => session.alongside)).toEqual([['api'], ['my-app']])
    expect(json.sessions[0].bullets).toEqual(['Shipped a fix'])
  })

  it('prints only the JSON in JSON mode — no saved-summary note or footer', async () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, summary: { format: 'json' } })
    dayOf([MY_APP], { summaries: [savedRow('skill', '## my-app — 1h\n- From the skill')] })
    mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledTimes(1)
    expect(() => JSON.parse(mockLog.plain.mock.calls[0][0])).not.toThrow()
  })

  it('keeps stdout to the JSON with --slack: posting status goes to stderr', async () => {
    mockReadConfig.mockReturnValue({
      ...BASE_CONFIG,
      summary: { format: 'json' },
      integrations: { slackWebhook: 'https://hooks.slack.com/services/T/B/X' },
    })
    mockIsSlackWebhookUrl.mockReturnValue(true)
    mockSummarize()

    await makeProgram().parseAsync(['summary', '--slack'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledTimes(1)
    expect(mockLog.notice).toHaveBeenCalledWith('Posted.')
  })

  it('skips --verbose in JSON mode, saying why on stderr', async () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, summary: { format: 'json' } })
    mockSummarize()

    await makeProgram().parseAsync(['summary', '--verbose'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledTimes(1)
    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('--verbose is skipped'))
  })

  it('posts the full summary, time worked included, to --webhook', async () => {
    mockSummarize()
    mockIsSlackWebhookUrl.mockReturnValue(false)

    await makeProgram().parseAsync(['summary', '--webhook', 'https://example.com/hook'], { from: 'user' })

    expect(mockPostToWebhook).toHaveBeenCalledWith(
      'https://example.com/hook',
      '## my-app (main) — 1h\n- Shipped a fix\n\nTime worked: 1h'
    )
  })

  it('serves a summary migrated from the 1.x sessions table', async () => {
    dayOf([MY_APP], { summaries: [savedRow('legacy', '## my-app — 1h\n- From 1.x')] })
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(summarize).not.toHaveBeenCalled()
    expect(mockLog.plain).toHaveBeenCalledWith('## my-app — 1h\n- From 1.x\n\nTime worked: 1h')
  })

  it('never serves a stored template summary — the template always renders fresh', async () => {
    dayOf([MY_APP], { summaries: [savedRow('template', '## my-app — 1h\n- Template text')] })
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(summarize).toHaveBeenCalledTimes(1)
  })

  it('shows a summary the agent skill saved for the thread instead of rendering the template', async () => {
    dayOf([MY_APP], { summaries: [savedRow('skill', '## my-app (main) — 1h\n- Written by the agent')] })
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(summarize).not.toHaveBeenCalled()
    expect(mockLog.plain).toHaveBeenCalledWith('## my-app (main) — 1h\n- Written by the agent\n\nTime worked: 1h')
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('1 written by the Workscribe agent skill'))
  })

  it('prefers the skill summary over a 1.x AI summary', async () => {
    dayOf([MY_APP], {
      summaries: [
        savedRow('provider', '## my-app — 1h\n- Provider text'),
        { ...savedRow('skill', '## my-app — 1h\n- Skill text'), id: 2 },
      ],
    })
    mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith('## my-app — 1h\n- Skill text\n\nTime worked: 1h')
  })

  it('asks git only about the threads the template tells, and hands their commits to the writer', async () => {
    dayOf([MY_APP, API], { summaries: [savedRow('skill', '## my-app — 1h\n- From the skill')] })
    const gitCommit = { hash: 'a1b2c3d', subject: 'feat: refresh tokens', committedAt: '2026-08-17T09:30:00.000Z' }
    vi.mocked(lookupDayCommits).mockReturnValue([[gitCommit]])
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(lookupDayCommits).toHaveBeenCalledWith(
      [{ cwd: '/Users/dev/api', startedAt: API.startedAt, endedAt: API.endedAt }],
      { budgetMs: 3000 }
    )
    expect(summarize.mock.calls[0][0].sessions[0].commits).toContainEqual(
      expect.objectContaining({ hash: 'a1b2c3d', subject: 'feat: refresh tokens' })
    )
  })

  it('generates only the threads without a saved summary', async () => {
    dayOf([MY_APP, API], { summaries: [savedRow('skill', '## my-app — 1h\n- From the skill')] })
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(summarize).toHaveBeenCalledTimes(1)
    expect(summarize.mock.calls[0][0].sessions[0].project).toBe('api')
    expect(mockLog.plain).toHaveBeenCalledWith(
      '## my-app — 1h\n- From the skill\n\n## api (main) — 1h\n- Shipped a fix\n\nTime worked: 1h'
    )
  })

  it('turns a saved skill summary into bullets in JSON mode', async () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, summary: { format: 'json' } })
    dayOf([MY_APP], { summaries: [savedRow('skill', '## my-app (main) — 1h\n- First outcome\n- Second outcome')] })
    mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    const [entry] = JSON.parse(mockLog.plain.mock.calls[0][0]).sessions
    expect(entry.bullets).toEqual(['First outcome', 'Second outcome'])
  })

  it('renders the template instead of the skill summary with --fresh', async () => {
    dayOf([MY_APP], { summaries: [savedRow('skill', '## my-app — 1h\n- From the skill')] })
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary', '--fresh'], { from: 'user' })

    expect(summarize).toHaveBeenCalledTimes(1)
  })

  it('names the "elsewhere" thread by its directory', async () => {
    dayOf([
      {
        ...MY_APP,
        projectId: null,
        repoName: null,
        events: [{ ...SHIPPING_EVENT, cwd: '/tmp/scripts', repo_name: null }],
      },
    ])
    mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('## /tmp/scripts (main) — 1h'))
  })

  it('warns when --slack is passed but no Slack webhook is configured', async () => {
    mockSummarize()

    await makeProgram().parseAsync(['summary', '--slack'], { from: 'user' })

    expect(mockPostToWebhook).not.toHaveBeenCalled()
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('integrations.slackWebhook'))
  })

  it('prints the 2.0 notice once for a 1.x config with AI provider settings', async () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, ai: { provider: 'anthropic', apiKey: 'sk-old' } })
    mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(mockLog.notice).toHaveBeenCalledTimes(1)
    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('AI providers were removed in Workscribe 2.0'))
  })

  it('prints no notice for a 2.0 config', async () => {
    mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(mockLog.notice).not.toHaveBeenCalled()
  })
})
