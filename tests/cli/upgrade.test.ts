import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/cli/data-jobs', () => ({
  runDataJobs: vi.fn(),
  getDataStatus: vi.fn(),
}))
vi.mock('../../src/cli/retention-run', () => ({ runRetentionAfterUpgrade: vi.fn() }))

import { Command } from 'commander'
import { getDataStatus, runDataJobs } from '../../src/cli/data-jobs'
import { registerUpgrade } from '../../src/cli/upgrade'
import { runRetentionAfterUpgrade } from '../../src/cli/retention-run'
import { log } from '../../src/utils/logger'
import type { JobRunResult } from '../../src/db/jobs/runner'

const mockRunDataJobs = runDataJobs as ReturnType<typeof vi.fn>
const mockGetDataStatus = getDataStatus as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const PASSED = { checked: 3, resolved: 3, unresolved: 0, hasPassed: true, notes: [] }

function makeProgram(): Command {
  const program = new Command()
  program.exitOverride()
  registerUpgrade(program)
  return program
}

function jobResult(overrides: Partial<JobRunResult> = {}): JobRunResult {
  return { name: 'projects', version: 1, outcome: 'done', verification: PASSED, ...overrides }
}

let exit: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mockGetDataStatus.mockReturnValue({
    pending: [],
    failed: null,
    failedChecks: [],
    unresolvedRows: 0,
    latestBackup: '/backups/b.db',
  })
  exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
})

describe('workscribe upgrade', () => {
  it('says the data is up to date when nothing is pending', async () => {
    mockRunDataJobs.mockReturnValue({ backup: 'not-needed', jobs: [] })

    await makeProgram().parseAsync(['upgrade'], { from: 'user' })

    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('up to date'))
    expect(exit).not.toHaveBeenCalled()
  })

  it('runs every pending job with no budget and prints each verification and the backup', async () => {
    mockRunDataJobs.mockReturnValue({ backup: 'ready', jobs: [jobResult()] })

    await makeProgram().parseAsync(['upgrade'], { from: 'user' })

    expect(mockRunDataJobs.mock.calls[0][1]).not.toHaveProperty('budgetMs')
    expect(mockLog.success).toHaveBeenCalledWith(
      expect.stringContaining('projects (v1) — checked 3, resolved 3, unresolved 0')
    )
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('/backups/b.db'))
    expect(exit).not.toHaveBeenCalled()
  })

  it('exits 1 when a job fails', async () => {
    mockRunDataJobs.mockReturnValue({
      backup: 'ready',
      jobs: [jobResult({ outcome: 'failed', error: 'boom', verification: undefined })],
    })
    mockGetDataStatus.mockReturnValue({
      pending: ['projects'],
      failed: { name: 'projects', error: 'boom' },
      failedChecks: [],
      unresolvedRows: 0,
      latestBackup: null,
    })

    await makeProgram().parseAsync(['upgrade'], { from: 'user' })

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('projects failed: boom'))
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('exits 1 when a check does not pass', async () => {
    mockRunDataJobs.mockReturnValue({
      backup: 'ready',
      jobs: [jobResult({ verification: { ...PASSED, hasPassed: false } })],
    })

    await makeProgram().parseAsync(['upgrade'], { from: 'user' })

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('check failed'))
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('asks to try again in a moment when another command is taking the backup', async () => {
    mockRunDataJobs.mockReturnValue({ backup: 'busy', jobs: [] })

    await makeProgram().parseAsync(['upgrade'], { from: 'user' })

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('backing up your data right now'))
    expect(mockLog.error).not.toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('keeps reporting a failed check on later runs, with the backup to go back to', async () => {
    mockRunDataJobs.mockReturnValue({ backup: 'not-needed', jobs: [] })
    mockGetDataStatus.mockReturnValue({
      pending: [],
      failed: null,
      failedChecks: ['projects'],
      unresolvedRows: 0,
      latestBackup: '/backups/b.db',
    })

    await makeProgram().parseAsync(['upgrade'], { from: 'user' })

    expect(mockLog.success).not.toHaveBeenCalled()
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining("check after upgrading projects didn't pass"))
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('/backups/b.db'))
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('passes on why a job paused', async () => {
    mockRunDataJobs.mockReturnValue({
      backup: 'ready',
      jobs: [
        jobResult({ outcome: 'paused', verification: undefined, error: 'started by a newer version of Workscribe' }),
      ],
    })

    await makeProgram().parseAsync(['upgrade'], { from: 'user' })

    expect(mockLog.warn).toHaveBeenCalledWith('projects paused: started by a newer version of Workscribe')
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('changes nothing and exits 1 when no backup could be taken', async () => {
    mockRunDataJobs.mockReturnValue({ backup: 'unavailable', jobs: [] })

    await makeProgram().parseAsync(['upgrade'], { from: 'user' })

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't back up"))
    expect(exit).toHaveBeenCalledWith(1)
  })

  describe('removing old data once the jobs are done (WOR-179)', () => {
    it('runs the removal after an upgrade that left the data up to date', async () => {
      mockRunDataJobs.mockReturnValue({ backup: 'not-needed', jobs: [] })

      await makeProgram().parseAsync(['upgrade'], { from: 'user' })

      expect(runRetentionAfterUpgrade).toHaveBeenCalledOnce()
    })

    it('does not run it when a job failed or a check did not pass, so it never gets ahead of the jobs', async () => {
      mockRunDataJobs.mockReturnValue({
        backup: 'ready',
        jobs: [jobResult({ outcome: 'failed', error: 'boom', verification: undefined })],
      })

      await makeProgram().parseAsync(['upgrade'], { from: 'user' })

      expect(runRetentionAfterUpgrade).not.toHaveBeenCalled()
    })
  })
})
