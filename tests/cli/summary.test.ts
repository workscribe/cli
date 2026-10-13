import { describe, it, expect, vi, beforeEach } from 'vitest'

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
import { log, debugLog } from '../../src/utils/logger'
import { parseBullets, registerSummary } from '../../src/cli/summary'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockGetOrBuildSessions = getOrBuildSessions as ReturnType<typeof vi.fn>
const mockGetProvider = getProvider as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
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
