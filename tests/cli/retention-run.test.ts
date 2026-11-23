import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/config', () => ({ readRetentionPolicy: vi.fn(() => ({ status: 'ok', retention: { days: 100 } })) }))
vi.mock('../../src/db/jobs', () => ({ JOBS: [] }))
vi.mock('../../src/utils/paths', () => ({ BACKUPS_DIR: '/backups' }))
vi.mock('../../src/db/retention-run', () => ({ runRetention: vi.fn() }))
vi.mock('../../src/db/retention-cleanup', () => ({
  isFileCleanupPending: vi.fn(() => false),
  isVacuumPending: vi.fn(() => false),
  runFileCleanup: vi.fn(),
}))

import { runRetention } from '../../src/db/retention-run'
import { isFileCleanupPending, isVacuumPending, runFileCleanup } from '../../src/db/retention-cleanup'
import { runRetentionAfterUpgrade, runRetentionBeforeCommand } from '../../src/cli/retention-run'
import { log } from '../../src/utils/logger'

const mockRun = vi.mocked(runRetention)
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const RAN = {
  status: 'ran',
  days: 100,
  events: 0,
  backupsRemoved: 0,
  stoppedBecause: 'finished',
  cleanup: 'clean',
} as const

beforeEach(() => {
  mockRun.mockReturnValue(RAN)
})

describe('runRetentionBeforeCommand', () => {
  it('runs with a time limit and never the VACUUM', () => {
    runRetentionBeforeCommand()

    const options = mockRun.mock.calls[0][1]
    expect(options.canVacuum).toBe(false)
    expect(options.isOverBudget).toBeTypeOf('function')
  })

  it('tells people about the removal the first time, with the date and how to keep everything', () => {
    mockRun.mockReturnValue({ status: 'announced', days: 100, firstRemovalOn: '2026-12-07' })

    runRetentionBeforeCommand()

    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('2026-12-07'))
    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('retention.keepForever'))
  })

  it('says how many events a run removed, and is silent when it removed none', () => {
    mockRun.mockReturnValue({ ...RAN, events: 42 })
    runRetentionBeforeCommand()
    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('42'))

    mockLog.notice.mockClear()
    mockRun.mockReturnValue(RAN)
    runRetentionBeforeCommand()
    expect(mockLog.notice).not.toHaveBeenCalled()
  })

  it('stays quiet while paused: only `upgrade` says so', () => {
    mockRun.mockReturnValue({ status: 'skipped', reason: { kind: 'paused', job: 'summary-days' } })

    runRetentionBeforeCommand()

    expect(mockLog.notice).not.toHaveBeenCalled()
  })

  it('never fails the command it runs before', () => {
    mockRun.mockImplementation(() => {
      throw new Error('database is locked')
    })

    expect(() => runRetentionBeforeCommand()).not.toThrow()
  })
})

describe('runRetentionAfterUpgrade', () => {
  it('runs with no time limit and may VACUUM', () => {
    runRetentionAfterUpgrade()

    const options = mockRun.mock.calls[0][1]
    expect(options.canVacuum).toBe(true)
    expect(options.isOverBudget).toBeUndefined()
  })

  it('says why nothing is removed when a job has not finished', () => {
    mockRun.mockReturnValue({ status: 'skipped', reason: { kind: 'paused', job: 'summary-days' } })

    runRetentionAfterUpgrade()

    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('summary-days'))
  })

  it('finishes a pending file cleanup, warning first that captures may be lost while the file is rewritten', () => {
    vi.mocked(isFileCleanupPending).mockReturnValue(true)
    vi.mocked(isVacuumPending).mockReturnValue(true)

    runRetentionAfterUpgrade()

    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('may be lost'))
    expect(runFileCleanup).toHaveBeenCalledWith(expect.anything(), { canVacuum: true })
  })
})
