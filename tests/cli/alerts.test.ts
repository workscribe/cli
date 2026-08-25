import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db/alerts', () => ({
  getPendingAlerts: vi.fn(),
  clearAlerts: vi.fn(),
  hasPendingAlerts: vi.fn(),
}))

vi.mock('../../src/utils/logger', () => ({
  log: { plain: vi.fn() },
}))

import { Command } from 'commander'
import { getPendingAlerts, clearAlerts, hasPendingAlerts } from '../../src/db/alerts'
import { log } from '../../src/utils/logger'
import { registerAlerts } from '../../src/cli/alerts'

const mockGetPendingAlerts = getPendingAlerts as ReturnType<typeof vi.fn>
const mockClearAlerts = clearAlerts as ReturnType<typeof vi.fn>
const mockHasPendingAlerts = hasPendingAlerts as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerAlerts(program)
  return program
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetPendingAlerts.mockReturnValue([])
  mockClearAlerts.mockReturnValue(0)
  mockHasPendingAlerts.mockReturnValue(false)
})

describe('workscribe alerts', () => {
  it('shows "No pending security alerts" when alerts list is empty', async () => {
    mockGetPendingAlerts.mockReturnValue([])
    await makeProgram().parseAsync(['alerts'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('No pending security alerts'))
  })

  it('shows alert details when there are pending alerts', async () => {
    mockGetPendingAlerts.mockReturnValue([
      {
        id: 1,
        created_at: Date.now(),
        tool: 'claude-code',
        session_id: 'sess-123',
        context: 'Possible credential detected in prompt submitted to AI tool',
        cleared: 0,
      },
    ])
    await makeProgram().parseAsync(['alerts'], { from: 'user' })
    const calls = mockLog.plain.mock.calls.flat().join(' ')
    expect(calls).toContain('claude-code')
    expect(calls).toContain('Possible credential')
  })

  it('shows "Security Alerts" heading when alerts are pending', async () => {
    mockGetPendingAlerts.mockReturnValue([
      {
        id: 1,
        created_at: Date.now(),
        tool: 'claude-code',
        session_id: null,
        context: 'Possible credential detected',
        cleared: 0,
      },
    ])
    await makeProgram().parseAsync(['alerts'], { from: 'user' })
    const calls = mockLog.plain.mock.calls.flat().join(' ')
    expect(calls).toContain('Security Alerts')
  })

  it('shows session ID when present in alert', async () => {
    mockGetPendingAlerts.mockReturnValue([
      {
        id: 1,
        created_at: Date.now(),
        tool: 'claude-code',
        session_id: 'sess-abc',
        context: 'Possible credential',
        cleared: 0,
      },
    ])
    await makeProgram().parseAsync(['alerts'], { from: 'user' })
    const calls = mockLog.plain.mock.calls.flat().join(' ')
    expect(calls).toContain('sess-abc')
  })

  it('omits session ID line when session_id is null', async () => {
    mockGetPendingAlerts.mockReturnValue([
      {
        id: 1,
        created_at: Date.now(),
        tool: 'claude-code',
        session_id: null,
        context: 'Possible credential',
        cleared: 0,
      },
    ])
    await makeProgram().parseAsync(['alerts'], { from: 'user' })
    const calls = mockLog.plain.mock.calls.flat().join(' ')
    expect(calls).not.toContain('Session:')
  })
})

describe('workscribe alerts clear', () => {
  it('calls clearAlerts and shows confirmation', async () => {
    mockClearAlerts.mockReturnValue(2)
    await makeProgram().parseAsync(['alerts', 'clear'], { from: 'user' })
    expect(mockClearAlerts).toHaveBeenCalledOnce()
    const calls = mockLog.plain.mock.calls.flat().join(' ')
    expect(calls).toContain('2 alerts cleared')
  })

  it('uses singular "alert" when count is one', async () => {
    mockClearAlerts.mockReturnValue(1)
    await makeProgram().parseAsync(['alerts', 'clear'], { from: 'user' })
    const calls = mockLog.plain.mock.calls.flat().join(' ')
    expect(calls).toContain('1 alert cleared')
    expect(calls).not.toContain('alerts cleared')
  })

  it('shows "No pending alerts" when there is nothing to clear', async () => {
    mockClearAlerts.mockReturnValue(0)
    await makeProgram().parseAsync(['alerts', 'clear'], { from: 'user' })
    const calls = mockLog.plain.mock.calls.flat().join(' ')
    expect(calls).toContain('No pending alerts')
  })
})

describe('workscribe alerts --check', () => {
  it('prints a warning when alerts are pending', async () => {
    mockHasPendingAlerts.mockReturnValue(true)
    await makeProgram().parseAsync(['alerts', '--check'], { from: 'user' })
    const calls = mockLog.plain.mock.calls.flat().join(' ')
    expect(calls).toContain('[workscribe]')
  })

  it('prints nothing when no alerts are pending', async () => {
    mockHasPendingAlerts.mockReturnValue(false)
    await makeProgram().parseAsync(['alerts', '--check'], { from: 'user' })
    expect(mockLog.plain).not.toHaveBeenCalled()
  })
})
