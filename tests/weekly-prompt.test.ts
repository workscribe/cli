import { describe, it, expect } from 'vitest'
import { buildWeeklyMessage } from '../src/ai/prompt'
import type { WeekSummaryPayload } from '../src/ai/types'

const TWO_DAY_PAYLOAD: WeekSummaryPayload = {
  weekStart: '2026-05-25',
  weekEnd: '2026-05-26',
  days: [
    {
      date: '2026-05-25',
      sessions: [
        {
          date: '2026-05-25',
          project: 'api-service',
          branch: 'feature/auth',
          startTime: '09:00',
          endTime: '11:00',
          durationMinutes: 120,
          events: [
            { category: 'code_commit', metadata: { message: 'fix: auth' }, exitCode: 0, durationMs: null },
            { category: 'test_run', metadata: {}, exitCode: 0, durationMs: null },
          ],
        },
      ],
    },
    {
      date: '2026-05-26',
      sessions: [
        {
          date: '2026-05-26',
          project: 'dashboard',
          branch: null,
          startTime: '14:00',
          endTime: '15:30',
          durationMinutes: 90,
          events: [
            { category: 'build', metadata: {}, exitCode: 0, durationMs: null },
            { category: 'build', metadata: {}, exitCode: 0, durationMs: null },
          ],
        },
      ],
    },
  ],
}

describe('buildWeeklyMessage', () => {
  it('includes the week range header', () => {
    const msg = buildWeeklyMessage(TWO_DAY_PAYLOAD)
    expect(msg).toContain('Week: 2026-05-25 to 2026-05-26')
  })

  it('includes day names with dates', () => {
    const msg = buildWeeklyMessage(TWO_DAY_PAYLOAD)
    expect(msg).toContain('Monday 2026-05-25')
    expect(msg).toContain('Tuesday 2026-05-26')
  })

  it('includes project and branch', () => {
    const msg = buildWeeklyMessage(TWO_DAY_PAYLOAD)
    expect(msg).toContain('api-service (feature/auth)')
  })

  it('omits branch when null', () => {
    const msg = buildWeeklyMessage(TWO_DAY_PAYLOAD)
    expect(msg).toContain('Project: dashboard —')
    expect(msg).not.toContain('dashboard (null)')
  })

  it('aggregates repeated events', () => {
    const msg = buildWeeklyMessage(TWO_DAY_PAYLOAD)
    expect(msg).toContain('2x build')
  })

  it('does not repeat single events with count prefix', () => {
    const msg = buildWeeklyMessage(TWO_DAY_PAYLOAD)
    expect(msg).toContain('test_run')
    expect(msg).not.toContain('1x test_run')
  })

  it('skips days with no sessions (empty days array entry is not added)', () => {
    const payload: WeekSummaryPayload = {
      weekStart: '2026-05-25',
      weekEnd: '2026-05-27',
      days: [TWO_DAY_PAYLOAD.days[0]],  // only Monday, Tuesday has no entry
    }
    const msg = buildWeeklyMessage(payload)
    expect(msg).not.toContain('Tuesday')
  })
})
