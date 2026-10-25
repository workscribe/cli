import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'

// summary.ts imports from '../db' and '../sessions/detector', both of which
// transitively load node:sqlite (Node 22+ only). Mock them before importing
// the module under test so the import chain never reaches node:sqlite.
vi.mock('../../src/db', () => ({
  updateSessionSummary: vi.fn(),
}))

vi.mock('../../src/sessions/detector', () => ({
  getOrBuildSessions: vi.fn(),
}))

vi.mock('../../src/ai/router', () => ({
  getProvider: vi.fn(),
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
  isoWeekKey: vi.fn(() => '2026-W34'),
}))

vi.mock('../../src/ai/prompt', () => ({
  buildExcludedSet: vi.fn(() => new Set()),
  countExcludedEvents: vi.fn(() => new Map()),
}))

import { Command } from 'commander'
import fs from 'fs'
import { getOrBuildSessions } from '../../src/sessions/detector'
import { getProvider } from '../../src/ai/router'
import { readConfig } from '../../src/config'
import { updateSessionSummary } from '../../src/db'
import { postToWebhook } from '../../src/integrations/webhook'
import { isSlackWebhookUrl } from '../../src/integrations/slack'
import { log, debugLog } from '../../src/utils/logger'
import { parseBullets, registerSummary } from '../../src/cli/summary'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockGetOrBuildSessions = getOrBuildSessions as ReturnType<typeof vi.fn>
const mockGetProvider = getProvider as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockUpdateSessionSummary = updateSessionSummary as ReturnType<typeof vi.fn>
const mockPostToWebhook = postToWebhook as ReturnType<typeof vi.fn>
const mockIsSlackWebhookUrl = isSlackWebhookUrl as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>
const mockDebugLog = debugLog as ReturnType<typeof vi.fn>

const FAKE_SESSION = {
  repoName: 'my-app',
  durationMinutes: 60,
  startedAt: '2026-08-17T09:00:00.000Z',
  endedAt: '2026-08-17T10:00:00.000Z',
  summary: null,
  events: [
    { category: 'shipping', metadata: '{"message":"fix: bug"}', exit_code: 0, duration_ms: null, branch: 'main' },
  ],
}

const BASE_CONFIG = { ai: { provider: 'anthropic' }, integrations: {} }

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
    mockGetProvider.mockReturnValue({ summarizeWeek: vi.fn().mockResolvedValue('# Week summary\n- Shipped a fix') })
    mockFs.existsSync.mockReturnValue(false)
  })

  it('generates and outputs a weekly summary', async () => {
    await makeProgram().parseAsync(['summary', '--week'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('Week summary'))
  })

  it('uses the "summary" wording when the weekly summary fails', async () => {
    mockGetProvider.mockReturnValue({ summarizeWeek: vi.fn().mockRejectedValue(new Error('connection refused')) })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
    onTestFinished(() => exitSpy.mockRestore())

    await makeProgram().parseAsync(['summary', '--week'], { from: 'user' })

    expect(mockLog.error).toHaveBeenCalledWith('Weekly summary failed [anthropic]: connection refused')
    expect(exitSpy).toHaveBeenCalledWith(1)
  })

  it('still shows the summary and exits cleanly when the cache write fails', async () => {
    mockFs.mkdirSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied')
    })

    await makeProgram().parseAsync(['summary', '--week'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('Week summary'))
    expect(mockLog.error).not.toHaveBeenCalled()
    expect(mockDebugLog).toHaveBeenCalledWith(
      'weekly-summary-cache',
      expect.objectContaining({ message: expect.stringContaining('EACCES') })
    )
  })
})

describe('workscribe summary (daily)', () => {
  const OTHER_EVENT = {
    category: 'other',
    metadata: '{"hint":"make deploy","tool":"make","target":"deploy"}',
    exit_code: 0,
    duration_ms: 1200,
    branch: 'main',
  }

  function mockSummarize(bullets = '- Shipped a fix') {
    const summarize = vi.fn().mockResolvedValue(bullets)
    mockGetProvider.mockReturnValue({ summarize })
    return summarize
  }

  beforeEach(() => {
    mockReadConfig.mockReturnValue(BASE_CONFIG)
    mockGetOrBuildSessions.mockReturnValue([{ ...FAKE_SESSION, id: 1 }])
  })

  it('summarizes each session separately and caches the result', async () => {
    mockGetOrBuildSessions.mockReturnValue([
      { ...FAKE_SESSION, id: 1 },
      { ...FAKE_SESSION, id: 2, repoName: 'api' },
    ])
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

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
          startTime: '09:00',
          endTime: '09:00',
          durationMinutes: 60,
          events: [{ category: 'shipping', metadata: { message: 'fix: bug' }, exitCode: 0, durationMs: null }],
        },
      ],
    })
    expect(mockUpdateSessionSummary).toHaveBeenCalledWith(1, '## my-app (main) — 1h\n- Shipped a fix')
    expect(mockUpdateSessionSummary).toHaveBeenCalledWith(2, '## api (main) — 1h\n- Shipped a fix')
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('## my-app (main) — 1h'))
  })

  it('lifts the hint out of other events and strips hint/tool from metadata', async () => {
    mockGetOrBuildSessions.mockReturnValue([{ ...FAKE_SESSION, id: 1, events: [OTHER_EVENT] }])
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    const [event] = summarize.mock.calls[0][0].sessions[0].events
    expect(event).toEqual({
      category: 'other',
      hint: 'make deploy',
      metadata: { target: 'deploy' },
      exitCode: 0,
      durationMs: 1200,
    })
  })

  it('serves cached summaries without calling the provider', async () => {
    mockGetOrBuildSessions.mockReturnValue([{ ...FAKE_SESSION, id: 1, summary: '## my-app — 1h\n- Cached work' }])
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    expect(summarize).not.toHaveBeenCalled()
    expect(mockLog.plain).toHaveBeenCalledWith('## my-app — 1h\n- Cached work')
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('cached'))
  })

  it('regenerates cached summaries when --fresh is passed', async () => {
    mockGetOrBuildSessions.mockReturnValue([{ ...FAKE_SESSION, id: 1, summary: '## my-app — 1h\n- Cached work' }])
    const summarize = mockSummarize()

    await makeProgram().parseAsync(['summary', '--fresh'], { from: 'user' })

    expect(summarize).toHaveBeenCalledTimes(1)
  })

  it('prints JSON when summary.format is json', async () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, summary: { format: 'json' } })
    mockSummarize('- First thing\n- Second thing')

    await makeProgram().parseAsync(['summary'], { from: 'user' })

    const expected = {
      date: '2026-08-17',
      sessions: [{ project: 'my-app', branch: 'main', durationMinutes: 60, bullets: ['First thing', 'Second thing'] }],
    }
    expect(mockLog.plain).toHaveBeenCalledWith(JSON.stringify(expected, null, 2))
  })

  it('posts the full summary to --webhook', async () => {
    mockSummarize()
    mockIsSlackWebhookUrl.mockReturnValue(false)

    await makeProgram().parseAsync(['summary', '--webhook', 'https://example.com/hook'], { from: 'user' })

    expect(mockPostToWebhook).toHaveBeenCalledWith('https://example.com/hook', '## my-app (main) — 1h\n- Shipped a fix')
  })

  it('warns when --slack is passed but no Slack webhook is configured', async () => {
    mockSummarize()

    await makeProgram().parseAsync(['summary', '--slack'], { from: 'user' })

    expect(mockPostToWebhook).not.toHaveBeenCalled()
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('integrations.slackWebhook'))
  })
})
