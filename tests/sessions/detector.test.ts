import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db', () => ({
  insertSession: vi.fn(),
  insertSessionEvent: vi.fn(),
  clearSessionsForDate: vi.fn(),
  getSessionsForDate: vi.fn(),
  getEventsForDate: vi.fn(),
  getEventsBySessionId: vi.fn(),
  countEventsBetween: vi.fn(),
  sumSessionEventCounts: vi.fn(),
  runInImmediateTransaction: vi.fn(),
}))
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ session: { idleTimeout: 30 } })) }))

import * as db from '../../src/db'
import { ensureDayGrouped, getOrBuildSessions } from '../../src/sessions/detector'

const mocked = vi.mocked(db)
const DATE = '2026-10-28'

function event(id: number, capturedAt: string) {
  return {
    id,
    captured_at: capturedAt,
    command: 'npm test',
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 10,
    repo_name: 'api',
    branch: 'main',
    category: 'testing',
    metadata: null,
    source: null,
    file_path: null,
  }
}

beforeEach(() => {
  mocked.runInImmediateTransaction.mockImplementation((work: () => unknown) => work())
  mocked.getSessionsForDate.mockReturnValue([])
  mocked.getEventsForDate.mockReturnValue([])
  mocked.getEventsBySessionId.mockReturnValue([])
  mocked.insertSession.mockReturnValue(1)
})

describe('ensureDayGrouped', () => {
  it('does nothing when the day is up to date — no lock, no rebuild', () => {
    mocked.countEventsBetween.mockReturnValue(4)
    mocked.sumSessionEventCounts.mockReturnValue(4)

    ensureDayGrouped(DATE)

    expect(mocked.runInImmediateTransaction).not.toHaveBeenCalled()
    expect(mocked.clearSessionsForDate).not.toHaveBeenCalled()
  })

  it('regroups a stale day inside the lock, with the lock wait asked for', () => {
    mocked.countEventsBetween.mockReturnValue(2)
    mocked.sumSessionEventCounts.mockReturnValue(0)
    mocked.getEventsForDate.mockReturnValue([
      event(1, '2026-10-28T09:00:00.000Z'),
      event(2, '2026-10-28T09:05:00.000Z'),
    ])

    ensureDayGrouped(DATE, { lockWaitMs: 1000 })

    expect(mocked.runInImmediateTransaction).toHaveBeenCalledWith(expect.any(Function), { busyTimeoutMs: 1000 })
    expect(mocked.clearSessionsForDate).toHaveBeenCalledWith(DATE)
    expect(mocked.insertSession).toHaveBeenCalledOnce()
    expect(mocked.insertSessionEvent).toHaveBeenCalledTimes(2)
  })

  it('skips the rebuild when another process regrouped the day while this one waited for the lock', () => {
    mocked.countEventsBetween.mockReturnValue(2)
    // Stale before the lock, up to date once it's held
    mocked.sumSessionEventCounts.mockReturnValueOnce(0).mockReturnValueOnce(2)

    ensureDayGrouped(DATE)

    expect(mocked.runInImmediateTransaction).toHaveBeenCalledOnce()
    expect(mocked.clearSessionsForDate).not.toHaveBeenCalled()
    expect(mocked.insertSession).not.toHaveBeenCalled()
  })

  it('gives a rebuilt session the summary stored on the session it replaces', () => {
    mocked.countEventsBetween.mockReturnValue(2)
    mocked.sumSessionEventCounts.mockReturnValue(1)
    mocked.getSessionsForDate.mockReturnValue([
      {
        id: 9,
        date: DATE,
        started_at: '2026-10-28T09:00:00.000Z',
        ended_at: '2026-10-28T09:00:00.000Z',
        repo_name: 'api',
        event_count: 1,
        summary: 'kept',
      },
    ])
    mocked.getEventsForDate.mockReturnValue([
      event(1, '2026-10-28T09:00:00.000Z'),
      event(2, '2026-10-28T09:05:00.000Z'),
    ])

    ensureDayGrouped(DATE)

    expect(mocked.insertSession).toHaveBeenCalledWith(expect.objectContaining({ summary: 'kept', event_count: 2 }))
  })
})

describe('getOrBuildSessions', () => {
  it('reads the grouped day back as sessions with their events', () => {
    mocked.countEventsBetween.mockReturnValue(1)
    mocked.sumSessionEventCounts.mockReturnValue(1)
    const events = [event(1, '2026-10-28T09:00:00.000Z')]
    mocked.getSessionsForDate.mockReturnValue([
      {
        id: 3,
        date: DATE,
        started_at: '2026-10-28T09:00:00.000Z',
        ended_at: '2026-10-28T09:30:00.000Z',
        repo_name: 'api',
        event_count: 1,
        summary: null,
      },
    ])
    mocked.getEventsBySessionId.mockReturnValue(events)

    expect(getOrBuildSessions(DATE)).toEqual([
      {
        id: 3,
        date: DATE,
        startedAt: '2026-10-28T09:00:00.000Z',
        endedAt: '2026-10-28T09:30:00.000Z',
        repoName: 'api',
        durationMinutes: 30,
        eventCount: 1,
        summary: null,
        events,
      },
    ])
  })
})
