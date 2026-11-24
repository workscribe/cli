import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/config', () => ({ readRetentionPolicy: vi.fn(() => ({ status: 'ok', retention: { days: 100 } })) }))
vi.mock('../../src/db/jobs', () => ({ JOBS: [] }))
vi.mock('../../src/utils/paths', () => ({ BACKUPS_DIR: '/backups' }))
vi.mock('../../src/db/retention-run', () => ({ runRetention: vi.fn() }))
vi.mock('../../src/db/retention-cleanup', () => ({
  isFileCleanupPending: vi.fn(() => false),
  runFileCleanup: vi.fn(),
}))

import { runRetention } from '../../src/db/retention-run'
import { isFileCleanupPending, runFileCleanup } from '../../src/db/retention-cleanup'
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
    mockRun.mockReturnValue({
      status: 'announced',
      days: 100,
      firstRemovalOn: '2026-12-07',
      preview: { eventDays: 12, events: 340 },
    })

    runRetentionBeforeCommand()

    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('2026-12-07'))
    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('retention.keepForever'))
    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('340 captured events, from 12 days'))
  })

  it.each([
    [10, 'in 10 days'],
    [1, 'tomorrow'],
  ])('reminds %i days before, saying "%s", the date and what goes', (daysUntil, wording) => {
    mockRun.mockReturnValue({
      status: 'waiting',
      days: 100,
      firstRemovalOn: '2026-12-07',
      daysUntil,
      reminder: { eventDays: 3, events: 20 },
    })

    runRetentionBeforeCommand()

    const message = mockLog.notice.mock.calls[0][0] as string
    expect(message).toContain(wording)
    expect(message).toContain('2026-12-07')
    expect(message).toContain('20 captured events, from 3 days')
    expect(message).toContain('retention.keepForever')
  })

  it('says nothing on a day with no reminder due', () => {
    mockRun.mockReturnValue({
      status: 'waiting',
      days: 100,
      firstRemovalOn: '2026-12-07',
      daysUntil: 8,
      reminder: null,
    })

    runRetentionBeforeCommand()

    expect(mockLog.notice).not.toHaveBeenCalled()
  })

  it('says, when nothing is old enough yet, that it then removes one day at a time', () => {
    mockRun.mockReturnValue({
      status: 'announced',
      days: 100,
      firstRemovalOn: '2027-03-04',
      preview: { eventDays: 0, events: 0 },
    })

    runRetentionBeforeCommand()

    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('one day at a time'))
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

  it('says how many summaries went when summaryDays removed some', () => {
    mockRun.mockReturnValue({ ...RAN, summaries: 3 })

    runRetentionBeforeCommand()

    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('3 saved summaries'))
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

  it('says why nothing is removed when the config has lost the limits, so it can be put back', () => {
    mockRun.mockReturnValue({ status: 'skipped', reason: { kind: 'unreadable', reason: 'retention is missing' } })

    runRetentionAfterUpgrade()

    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('Nothing is removed: retention is missing'))
  })

  it('says nothing for a reason a person has no use for, such as having kept everything', () => {
    mockRun.mockReturnValue({ status: 'skipped', reason: { kind: 'keep-forever' } })

    runRetentionAfterUpgrade()

    expect(mockLog.notice).not.toHaveBeenCalled()
  })

  it('says why nothing is removed when a job has not finished', () => {
    mockRun.mockReturnValue({ status: 'skipped', reason: { kind: 'paused', job: 'summary-days' } })

    runRetentionAfterUpgrade()

    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('summary-days'))
  })

  it('warns, right before the VACUUM that this run does, that captures may be lost while it runs', () => {
    mockRun.mockImplementation((_db, options) => {
      options.beforeVacuum?.()
      return RAN
    })

    runRetentionAfterUpgrade()

    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('may be lost'))
    expect(mockLog.notice).toHaveBeenCalledTimes(1)
  })

  it('finishes a cleanup left from an earlier run, with the same warning first', () => {
    vi.mocked(isFileCleanupPending).mockReturnValue(true)
    vi.mocked(runFileCleanup).mockImplementation((_db, options) => {
      options.beforeVacuum?.()
      return 'clean'
    })

    runRetentionAfterUpgrade()

    expect(runFileCleanup).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ canVacuum: true }))
    expect(mockLog.notice).toHaveBeenCalledWith(expect.stringContaining('may be lost'))
  })
})
