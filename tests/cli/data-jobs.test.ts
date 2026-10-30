import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({ fake: 'db' })) }))
vi.mock('../../src/db/jobs/runner', () => ({ runPendingJobs: vi.fn(() => ({ backup: 'not-needed', jobs: [] })) }))
vi.mock('../../src/db/jobs/state', () => ({ recordCliVersion: vi.fn(), readDataStatus: vi.fn() }))
vi.mock('../../src/db/jobs/backup', () => ({ ensureBackup: vi.fn() }))
vi.mock('../../src/utils/paths')

import { runDataJobsBeforeCommand, IMPLICIT_RUN_BUDGET_MS } from '../../src/cli/data-jobs'
import { runPendingJobs } from '../../src/db/jobs/runner'
import { recordCliVersion } from '../../src/db/jobs/state'
import { ensureBackup } from '../../src/db/jobs/backup'
import { log } from '../../src/utils/logger'
import type { RunOptions } from '../../src/db/jobs/runner'

const mockRunPendingJobs = runPendingJobs as ReturnType<typeof vi.fn>
const mockRecordCliVersion = recordCliVersion as ReturnType<typeof vi.fn>
const mockEnsureBackup = ensureBackup as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

function runOptions(): RunOptions {
  return mockRunPendingJobs.mock.calls[0][2] as RunOptions
}

beforeEach(() => {
  mockRunPendingJobs.mockReturnValue({ backup: 'not-needed', jobs: [] })
})

describe('runDataJobsBeforeCommand', () => {
  it('records the version and runs pending jobs within the budget', () => {
    runDataJobsBeforeCommand('summary', '2.2.0')

    expect(mockRecordCliVersion).toHaveBeenCalledWith({ fake: 'db' }, '2.2.0')
    expect(runOptions().budgetMs).toBe(IMPLICIT_RUN_BUDGET_MS)
  })

  it('leaves the jobs to `upgrade` itself, but still records the version', () => {
    runDataJobsBeforeCommand('upgrade', '2.2.0')

    expect(mockRecordCliVersion).toHaveBeenCalled()
    expect(mockRunPendingJobs).not.toHaveBeenCalled()
  })

  it('backs up into the backups folder for this version, announcing it on stderr', () => {
    mockEnsureBackup.mockImplementation((_db, options) => {
      options.onCreate()
      return { status: 'created', path: '/backups/b.db' }
    })
    runDataJobsBeforeCommand('summary', '2.2.0')

    expect(runOptions().ensureBackup()).toBe('ready')
    expect(mockEnsureBackup).toHaveBeenCalledWith(
      { fake: 'db' },
      expect.objectContaining({ cliVersion: '2.2.0', directory: '/home/user/.workscribe/backups' })
    )
    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('Backing up'))
  })

  it('reports a failed backup and lets no job run', () => {
    mockEnsureBackup.mockReturnValue({ status: 'failed', error: 'disk full' })
    runDataJobsBeforeCommand('summary', '2.2.0')

    expect(runOptions().ensureBackup()).toBe('unavailable')
    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('disk full'))
  })

  it('passes on a backup another process is taking, without calling it a failure', () => {
    mockEnsureBackup.mockReturnValue({ status: 'busy' })
    runDataJobsBeforeCommand('summary', '2.2.0')

    expect(runOptions().ensureBackup()).toBe('busy')
    expect(mockLog.notice).not.toHaveBeenCalled()
  })

  it('notices slow runs once, and only after a second', () => {
    runDataJobsBeforeCommand('summary', '2.2.0')
    const { onProgress } = runOptions()
    const job = { name: 'projects' } as never

    onProgress?.({ job, elapsedMs: 200 })
    expect(mockLog.notice).not.toHaveBeenCalled()
    onProgress?.({ job, elapsedMs: 1200 })
    onProgress?.({ job, elapsedMs: 1800 })
    expect(mockLog.notice).toHaveBeenCalledTimes(1)
  })

  it('never fails the command', () => {
    mockRunPendingJobs.mockImplementation(() => {
      throw new Error('database is locked')
    })

    expect(() => runDataJobsBeforeCommand('summary', '2.2.0')).not.toThrow()
    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('database is locked'))
  })
})
