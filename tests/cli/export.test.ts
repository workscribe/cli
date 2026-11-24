import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'

vi.mock('../../src/cli/thread-day', () => ({
  requireThreadData: vi.fn(),
  loadDayThreads: vi.fn(),
}))

vi.mock('../../src/summary/writer', () => ({
  createSummaryWriter: vi.fn(),
}))

vi.mock('../../src/config', () => ({
  readConfig: vi.fn(),
}))

// The db module would load node:sqlite
vi.mock('../../src/db', () => ({}))

vi.mock('../../src/cli/kept-day', () => ({ keptSummariesOf: vi.fn(() => []) }))

vi.mock('../../src/summary/exclusions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/summary/exclusions')>()),
  countExcludedEvents: vi.fn(() => new Map()),
}))

vi.mock('../../src/summary/day-commits', () => ({
  DAY_GIT_BUDGET_MS: 3000,
  lookupDayCommits: vi.fn((windows: unknown[]) => windows.map(() => null)),
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
import { loadDayThreads, requireThreadData } from '../../src/cli/thread-day'
import { keptSummariesOf } from '../../src/cli/kept-day'
import { block, row, thread } from '../summary/contract/fixtures'
import { createSummaryWriter } from '../../src/summary/writer'
import { readConfig } from '../../src/config'
import { countExcludedEvents } from '../../src/summary/exclusions'
import { log } from '../../src/utils/logger'
import { registerExport } from '../../src/cli/export'
import { TemplateProvider } from '../../src/ai/engines/template/provider'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockLoadDayThreads = vi.mocked(loadDayThreads)
const mockCreateSummaryWriter = createSummaryWriter as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const BASE_CONFIG = { session: { idleTimeout: 30 } }

const COMMIT_EVENT = row({
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
})

function dayOf(events = [COMMIT_EVENT], summaries: Parameters<typeof block>[1]['summaries'] = []) {
  const myapp = thread(events, {
    projectId: 4,
    repoName: 'myapp',
    key: 'myapp|2026-05-28T09:00:00Z',
    startedAt: '2026-05-28T09:00:00Z',
    endedAt: '2026-05-28T10:30:00Z',
    activeSlots: 18,
  })
  return [block([myapp], { date: '2026-05-28', activeSlots: 18, summaries })]
}

const SAMPLE_BLOCKS = dayOf()

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
      mockLoadDayThreads.mockReturnValue([])
      const mockProvider = { summarize: vi.fn() }
      mockCreateSummaryWriter.mockReturnValue(mockProvider)

      await makeProgram().parseAsync(['export'], { from: 'user' })

      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('No activity captured'))
      expect(mockProvider.summarize).not.toHaveBeenCalled()
    })
  })

  describe('a day whose events were removed (WOR-179)', () => {
    it('exports the summaries saved for it, with the note, and never calls the writer', async () => {
      mockLoadDayThreads.mockReturnValue([])
      vi.mocked(keptSummariesOf).mockReturnValue(['## api (main) — 1h\n\nFixed the refresh race.'])
      const mockProvider = { summarize: vi.fn() }
      mockCreateSummaryWriter.mockReturnValue(mockProvider)

      await makeProgram().parseAsync(['export', '--date', '2026-08-01', '--output', '/tmp/out.md'], { from: 'user' })

      const written = vi.mocked(fs.writeFileSync).mock.calls[0]
      expect(written[0]).toBe('/tmp/out.md')
      expect(String(written[1])).toContain('# Work Summary — 2026-08-01')
      expect(String(written[1])).toContain('Fixed the refresh race.')
      expect(String(written[1])).toContain('has been removed')
      expect(mockProvider.summarize).not.toHaveBeenCalled()
    })
  })

  describe('happy path', () => {
    it('summarizes the day and writes the output file', async () => {
      const mockProvider = { summarize: vi.fn().mockResolvedValue('## Summary\n\nDid some coding.') }
      mockLoadDayThreads.mockReturnValue(SAMPLE_BLOCKS)
      mockCreateSummaryWriter.mockReturnValue(mockProvider)

      await makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })

      expect(mockProvider.summarize).toHaveBeenCalledOnce()
      expect(mockFs.writeFileSync).toHaveBeenCalledOnce()
    })

    it('exports offline with the template engine, every thread under its heading, then the time worked', async () => {
      mockLoadDayThreads.mockReturnValue(dayOf([{ ...COMMIT_EVENT, metadata: '{"message":"fix: login"}' }]))
      mockCreateSummaryWriter.mockReturnValue(new TemplateProvider())

      await makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })

      expect(mockFs.writeFileSync).toHaveBeenCalledWith(
        expect.any(String),
        '# Work Summary — 2026-05-28\n\n## myapp (main) — 1h 30m\n- Committed: fix: login\n\nTime worked: 1h 30m\n',
        expect.any(Object)
      )
    })

    it('writes to the default exports directory path', async () => {
      const mockProvider = { summarize: vi.fn().mockResolvedValue('summary') }
      mockLoadDayThreads.mockReturnValue(SAMPLE_BLOCKS)
      mockCreateSummaryWriter.mockReturnValue(mockProvider)

      await makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })

      const [writePath] = mockFs.writeFileSync.mock.calls[0] as [string, ...unknown[]]
      expect(writePath).toContain('workscribe-2026-05-28.md')
    })

    it('logs a success message with the output path', async () => {
      const mockProvider = { summarize: vi.fn().mockResolvedValue('summary') }
      mockLoadDayThreads.mockReturnValue(SAMPLE_BLOCKS)
      mockCreateSummaryWriter.mockReturnValue(mockProvider)

      await makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })

      expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('Saved'))
    })
  })

  describe('the data upgrade', () => {
    it("stops before reading the day while it isn't finished", async () => {
      vi.mocked(requireThreadData).mockImplementationOnce(() => {
        throw new Error('exit')
      })

      await expect(makeProgram().parseAsync(['export'], { from: 'user' })).rejects.toThrow('exit')

      expect(mockLoadDayThreads).not.toHaveBeenCalled()
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })
  })

  describe('--output', () => {
    it('writes to the custom path when --output is provided', async () => {
      const mockProvider = { summarize: vi.fn().mockResolvedValue('summary') }
      mockLoadDayThreads.mockReturnValue(SAMPLE_BLOCKS)
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

  describe('the same day as workscribe summary', () => {
    const skillSummary = {
      id: 1,
      scope: 'session',
      project_id: 4,
      first_event_id: 1,
      last_event_id: 1,
      engine: 'skill' as const,
      text: '## myapp (main) — 1h 30m\n- Shipped the login fix',
      created_at: '2026-05-28T11:00:00Z',
      source_key: 'myapp|2026-05-28T09:00:00Z',
      origin: 'saved' as const,
      anchor_source: 'thread' as const,
      is_mixed: 0,
    }

    it('writes the summary the agent skill saved, and says so on the console, not in the file', async () => {
      const mockProvider = { summarize: vi.fn() }
      mockLoadDayThreads.mockReturnValue(dayOf([COMMIT_EVENT], [skillSummary]))
      mockCreateSummaryWriter.mockReturnValue(mockProvider)

      await makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })

      expect(mockProvider.summarize).not.toHaveBeenCalled()
      const [, content] = mockFs.writeFileSync.mock.calls[0] as [string, string]
      expect(content).toBe(
        '# Work Summary — 2026-05-28\n\n## myapp (main) — 1h 30m\n- Shipped the login fix\n\nTime worked: 1h 30m\n'
      )
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('written by the Workscribe agent skill'))
    })

    it('renders the template instead with --fresh', async () => {
      mockLoadDayThreads.mockReturnValue(dayOf([COMMIT_EVENT], [skillSummary]))
      mockCreateSummaryWriter.mockReturnValue(new TemplateProvider())

      await makeProgram().parseAsync(['export', '--date', '2026-05-28', '--fresh'], { from: 'user' })

      const [, content] = mockFs.writeFileSync.mock.calls[0] as [string, string]
      expect(content).not.toContain('Shipped the login fix')
      expect(content).toContain('## myapp (main) — 1h 30m')
    })

    it('prints the left-out events on the console, not into the file', async () => {
      vi.mocked(countExcludedEvents).mockReturnValue(new Map([['exploring', 3]]))
      mockLoadDayThreads.mockReturnValue(SAMPLE_BLOCKS)
      mockCreateSummaryWriter.mockReturnValue(new TemplateProvider())

      await makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })

      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('3 events not included in summary'))
      const [, content] = mockFs.writeFileSync.mock.calls[0] as [string, string]
      expect(content).not.toContain('not included')
    })

    it('always writes markdown, even with summary.format set to json', async () => {
      mockReadConfig.mockReturnValue({ ...BASE_CONFIG, summary: { format: 'json' } })
      mockLoadDayThreads.mockReturnValue(SAMPLE_BLOCKS)
      mockCreateSummaryWriter.mockReturnValue(new TemplateProvider())

      await makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })

      const [, content] = mockFs.writeFileSync.mock.calls[0] as [string, string]
      expect(content).toMatch(/^# Work Summary — 2026-05-28\n\n## myapp/)
    })

    it('says so and stops when the summary fails', async () => {
      mockLoadDayThreads.mockReturnValue(SAMPLE_BLOCKS)
      mockCreateSummaryWriter.mockReturnValue({ summarize: vi.fn().mockRejectedValue(new Error('disk full')) })
      // A real exit stops the command here
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit')
      })
      onTestFinished(() => exitSpy.mockRestore())

      await expect(makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })).rejects.toThrow()

      expect(mockLog.error).toHaveBeenCalledWith('Export failed: disk full')
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    })
  })

  describe('old AI settings', () => {
    beforeEach(() => {
      mockLoadDayThreads.mockReturnValue(SAMPLE_BLOCKS)
      mockCreateSummaryWriter.mockReturnValue({ summarize: vi.fn().mockResolvedValue('- Did some coding') })
    })

    it('prints the 2.0 notice once for a 1.x config, even on a day with no activity', async () => {
      mockReadConfig.mockReturnValue({ ...BASE_CONFIG, ai: { provider: 'openai', apiKey: 'sk-old' } })
      mockLoadDayThreads.mockReturnValue([])

      await makeProgram().parseAsync(['export'], { from: 'user' })

      expect(mockLog.notice).toHaveBeenCalledTimes(1)
    })

    it('prints no notice for a 2.0 config', async () => {
      await makeProgram().parseAsync(['export', '--date', '2026-05-28'], { from: 'user' })

      expect(mockLog.notice).not.toHaveBeenCalled()
    })
  })
})
