import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/config', () => ({ readRetentionPolicy: vi.fn(() => ({ status: 'ok', retention: { days: 100 } })) }))
vi.mock('../../src/db/jobs', () => ({ JOBS: [] }))
vi.mock('../../src/utils/paths', () => ({ BACKUPS_DIR: '/backups' }))
vi.mock('../../src/db/retention-run', () => ({ runRetention: vi.fn() }))
vi.mock('../../src/db/retention-status', () => ({ retentionStatusOf: vi.fn() }))
vi.mock('../../src/db/retention-cleanup', () => ({ isFileCleanupPending: vi.fn(() => false) }))

import { Command } from 'commander'
import { runRetention } from '../../src/db/retention-run'
import { retentionStatusOf, type RetentionStatus } from '../../src/db/retention-status'
import { isFileCleanupPending } from '../../src/db/retention-cleanup'
import { registerRetention, retentionLines, retentionStatusLine } from '../../src/cli/retention'
import { log } from '../../src/utils/logger'

const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const ACTIVE: RetentionStatus = {
  mode: 'removing',
  days: 100,
  summaryDays: null,
  reason: null,
  pausedBy: null,
  oldestDay: '2026-08-16',
  oldestDayRemovedOn: '2026-11-24',
  startsOn: '2026-12-07',
  next: { on: '2026-11-24', events: 340, eventDays: 1 },
}

// chalk's colour codes are off under test, but a wrapped value must still read as one sentence
const text = (lines: string[]): string => lines.join('\n')

function program(): Command {
  const command = new Command()
  command.exitOverride()
  registerRetention(command)
  return command
}

beforeEach(() => {
  vi.mocked(retentionStatusOf).mockReturnValue(ACTIVE)
})

describe('retentionLines', () => {
  it('says how long events are kept, the oldest day and when it goes, and what the next removal takes', () => {
    const output = text(retentionLines(ACTIVE))

    expect(output).toContain('kept 100 days, then removed')
    expect(output).toContain('2026-08-16, removed on 2026-11-24')
    expect(output).toContain('2026-11-24: 340 captured events, from 1 day')
    expect(output).toContain('workscribe config set retention.keepForever true')
  })

  it('says summaries are kept until removed, or after their own limit', () => {
    expect(text(retentionLines(ACTIVE))).toContain('kept until you remove them')
    expect(text(retentionLines({ ...ACTIVE, summaryDays: 365 }))).toContain('removed after 365 days')
  })

  it('says kept forever, with no next removal and no tip to keep everything', () => {
    const output = text(retentionLines({ ...ACTIVE, mode: 'keep-forever', next: null, oldestDayRemovedOn: null }))

    expect(output).toContain('kept forever')
    expect(output).not.toContain('Next removal')
    expect(output).not.toContain('To keep everything')
  })

  it('says why nothing is removed when the config cannot be read', () => {
    const output = text(
      retentionLines({ ...ACTIVE, mode: 'unreadable', reason: 'retention is not an object', next: null })
    )

    expect(output).toContain('nothing is removed')
    expect(output).toContain('retention is not an object')
  })

  it('names the job it is paused on and says what to run', () => {
    const output = text(retentionLines({ ...ACTIVE, mode: 'paused', pausedBy: 'summary-days' }))

    expect(output).toContain('until summary-days has finished: run workscribe upgrade')
  })

  it('says when removal starts, while it has not', () => {
    expect(text(retentionLines({ ...ACTIVE, mode: 'waiting' }))).toContain('Starts')
  })

  it('says nothing is old enough yet instead of a count of zero', () => {
    const output = text(retentionLines({ ...ACTIVE, next: { on: '2027-03-04', events: 0, eventDays: 0 } }))

    expect(output).toContain('nothing is old enough yet')
  })
})

describe('retentionStatusLine', () => {
  it.each([
    [ACTIVE, '100 days', 'oldest day goes 2026-11-24'],
    [{ ...ACTIVE, mode: 'keep-forever' as const }, 'kept forever', ''],
    [{ ...ACTIVE, mode: 'unreadable' as const }, 'nothing is removed', 'config unreadable'],
    [{ ...ACTIVE, mode: 'paused' as const, pausedBy: 'summary-days' }, 'paused', 'until summary-days finishes'],
  ])('is one line for %#', (status, first, second) => {
    const line = retentionStatusLine(status)

    expect(line).not.toContain('\n')
    expect(line).toContain('Retention')
    expect(line).toContain(first)
    expect(line).toContain(second)
  })
})

describe('workscribe retention', () => {
  it('prints the picture', async () => {
    await program().parseAsync(['retention'], { from: 'user' })

    const printed = mockLog.plain.mock.calls.map((call) => String(call[0])).join('\n')
    expect(printed).toContain('Workscribe Retention')
    expect(printed).toContain('kept 100 days')
  })
})

describe('workscribe retention run', () => {
  const ran = {
    status: 'ran',
    days: 100,
    events: 7,
    summaries: 0,
    backupsRemoved: 1,
    stoppedBecause: 'finished',
    cleanup: 'clean',
  } as const

  it('removes now, ignoring the daily limit and with no time limit, and says what went', async () => {
    vi.mocked(runRetention).mockReturnValue(ran)

    await program().parseAsync(['retention', 'run'], { from: 'user' })

    const options = vi.mocked(runRetention).mock.calls[0][1]
    expect(options.ignoreThrottle).toBe(true)
    expect(options.isOverBudget).toBeUndefined()
    expect(options.canVacuum).toBe(false)
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('7 captured events and 1 old backups'))
  })

  it('says when removal has not started, and removes nothing before then', async () => {
    vi.mocked(runRetention).mockReturnValue({
      status: 'waiting',
      days: 100,
      firstRemovalOn: '2026-12-07',
      daysUntil: 5,
      reminder: null,
    })

    await program().parseAsync(['retention', 'run'], { from: 'user' })

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('starts on 2026-12-07'))
  })

  it('points to upgrade when the VACUUM is still to do', async () => {
    vi.mocked(runRetention).mockReturnValue(ran)
    vi.mocked(isFileCleanupPending).mockReturnValue(true)

    await program().parseAsync(['retention', 'run'], { from: 'user' })

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('workscribe upgrade'))
  })

  it.each([
    [{ kind: 'keep-forever' }, 'retention.keepForever is on'],
    [{ kind: 'unreadable', reason: 'broken' }, 'broken'],
    [{ kind: 'paused', job: 'summary-days' }, 'summary-days'],
    [{ kind: 'throttled' }, 'Already ran today'],
  ] as const)('says why nothing was removed: %j', async (reason, wording) => {
    vi.mocked(runRetention).mockReturnValue({ status: 'skipped', reason })

    await program().parseAsync(['retention', 'run'], { from: 'user' })

    const said = [...mockLog.info.mock.calls, ...mockLog.warn.mock.calls].map((call) => String(call[0])).join('\n')
    expect(said).toContain(wording)
  })
})
