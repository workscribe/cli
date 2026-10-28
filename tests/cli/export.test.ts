import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/sessions/detector', () => ({
  getOrBuildSessions: vi.fn(),
}))

vi.mock('../../src/summary/writer', () => ({
  createSummaryWriter: vi.fn(),
}))

vi.mock('../../src/config', () => ({
  readConfig: vi.fn(),
}))

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}))

vi.mock('../../src/utils/paths')

import fs from 'fs'
import { Command } from 'commander'
import { getOrBuildSessions } from '../../src/sessions/detector'
import { createSummaryWriter } from '../../src/summary/writer'
import { readConfig } from '../../src/config'
import { log } from '../../src/utils/logger'
import { registerExport } from '../../src/cli/export'
import { TemplateProvider } from '../../src/ai/engines/template/provider'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockGetOrBuildSessions = getOrBuildSessions as ReturnType<typeof vi.fn>
const mockCreateSummaryWriter = createSummaryWriter as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const BASE_CONFIG = { session: { idleTimeout: 30 } }

const SAMPLE_SESSIONS = [
  {
    id: 1,
    date: '2026-05-28',
    startedAt: '2026-05-28T09:00:00Z',
    endedAt: '2026-05-28T10:30:00Z',
    repoName: 'myapp',
    durationMinutes: 90,
    eventCount: 1,
    summary: null,
    events: [
      {
        id: 1,
        category: 'shipping',
        captured_at: '2026-05-28T09:00:00Z',
        command: 'git commit',
        cwd: '/repo',
        exit_code: 0,
        duration_ms: 100,
        repo_name: 'myapp',
        branch: 'main',
        metadata: null,
      },
    ],
  },
]

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerExport(program)
  return program
}

beforeEach(() => {
  mockReadConfig.mockReturnValue(BASE_CONFIG)
  mockFs.existsSync.mockReturnValue(true)
  mockFs.mkdirSync.mockReturnValue(undefined)
  mockFs.writeFileSync.mockReturnValue(undefined)
})

describe('workscribe export', () => {
  describe('no sessions', () => {
    it('logs no-activity message and does not summarize', async () => {
      mockGetOrBuildSessions.mockReturnValue([])
      const mockProvider = { summarize: vi.fn() }
      mockCreateSummaryWriter.mockReturnValue(mockProvider)

      await makeProgram().parseAsync(['export'], { from: 'user' })

      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('No activity captured'))
      expect(mockProvider.summarize).not.toHaveBeenCalled()
    })
  })

  describe('happy path', () => {
    it('summarizes the day and writes the output file', async () => {
      const mockProvider = { summarize: vi.fn().mockResolvedValue('## Summary\n\nDid some coding.') }
      mockGetOrBuildSessions.mockReturnValue(SAMPLE_SESSIONS)
      mockCreateSummaryWriter.mockReturnValue(mockProvider)

      await makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })

      expect(mockProvider.summarize).toHaveBeenCalledOnce()
      expect(mockFs.writeFileSync).toHaveBeenCalledOnce()
    })

    it('exports offline with the template engine, every session under its heading', async () => {
      mockGetOrBuildSessions.mockReturnValue([
        { ...SAMPLE_SESSIONS[0], events: [{ ...SAMPLE_SESSIONS[0].events[0], metadata: '{"message":"fix: login"}' }] },
      ])
      mockCreateSummaryWriter.mockReturnValue(new TemplateProvider())

      await makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        '# Work Summary — 2026-05-28\n\n## myapp (main) — 1h 30m\n- Committed: fix: login\n',
        expect.any(Object)
      )
    })

    it('writes to the default exports directory path', async () => {
      const mockProvider = { summarize: vi.fn().mockResolvedValue('summary') }
      mockGetOrBuildSessions.mockReturnValue(SAMPLE_SESSIONS)
      mockCreateSummaryWriter.mockReturnValue(mockProvider)

      await makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })

      const [writePath] = mockFs.writeFileSync.mock.calls[0] as [string, ...unknown[]]
      expect(writePath).toContain('workscribe-2026-05-28.md')
    })

    it('logs a success message with the output path', async () => {
      const mockProvider = { summarize: vi.fn().mockResolvedValue('summary') }
      mockGetOrBuildSessions.mockReturnValue(SAMPLE_SESSIONS)
      mockCreateSummaryWriter.mockReturnValue(mockProvider)

      await makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })

      expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('Saved'))
    })
  })

  describe('--output', () => {
    it('writes to the custom path when --output is provided', async () => {
      const mockProvider = { summarize: vi.fn().mockResolvedValue('summary') }
      mockGetOrBuildSessions.mockReturnValue(SAMPLE_SESSIONS)
      mockCreateSummaryWriter.mockReturnValue(mockProvider)

      await makeProgram().parseAsync(['export', '--output', '/tmp/my-summary.md'], { from: 'user' })

      const [writePath] = mockFs.writeFileSync.mock.calls[0] as [string, ...unknown[]]
      expect(writePath).toBe('/tmp/my-summary.md')
    })
  })

  describe('--date', () => {
    it('logs an error and exits on an invalid date', async () => {
      await expect(makeProgram().parseAsync(['export', '--date', 'not-a-date'], { from: 'user' })).rejects.toThrow()
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Invalid date'))
    })
  })

  describe('old AI settings', () => {
    beforeEach(() => {
      mockGetOrBuildSessions.mockReturnValue(SAMPLE_SESSIONS)
      mockCreateSummaryWriter.mockReturnValue({ summarize: vi.fn().mockResolvedValue('- Did some coding') })
    })

    it('prints the 2.0 notice once for a 1.x config, even on a day with no activity', async () => {
      mockReadConfig.mockReturnValue({ ...BASE_CONFIG, ai: { provider: 'openai', apiKey: 'sk-old' } })
      mockGetOrBuildSessions.mockReturnValue([])

      await makeProgram().parseAsync(['export'], { from: 'user' })

      expect(mockLog.notice).toHaveBeenCalledTimes(1)
    })

    it('prints no notice for a 2.0 config', async () => {
      await makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })

      expect(mockLog.notice).not.toHaveBeenCalled()
    })
  })
})
