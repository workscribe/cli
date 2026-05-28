import { describe, it, expect } from 'vitest'
import { buildWeeklyMessage, buildUserMessage } from '../src/ai/prompt'
import type { WeekSummaryPayload, DaySummaryPayload } from '../src/ai/types'

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

  it('excludes server_run and git_other from weekly payload', () => {
    const payload: WeekSummaryPayload = {
      weekStart: '2026-05-25',
      weekEnd: '2026-05-25',
      days: [{
        date: '2026-05-25',
        sessions: [{
          date: '2026-05-25',
          project: 'api-service',
          branch: 'main',
          startTime: '09:00',
          endTime: '10:00',
          durationMinutes: 60,
          events: [
            { category: 'server_run', metadata: { tool: 'npm', script: 'dev' }, exitCode: 0, durationMs: null },
            { category: 'git_other', metadata: { subcommand: 'status' }, exitCode: 0, durationMs: null },
            { category: 'code_commit', metadata: { message: 'fix: bug' }, exitCode: 0, durationMs: null },
          ],
        }],
      }],
    }
    const msg = buildWeeklyMessage(payload)
    expect(msg).not.toContain('server_run')
    expect(msg).not.toContain('git_other')
    expect(msg).toContain('code_commit')
  })
})

describe('buildUserMessage', () => {
  const makePayload = (events: { category: string; metadata?: Record<string, unknown> }[]): DaySummaryPayload => ({
    date: '2026-05-28',
    sessions: [{
      date: '2026-05-28',
      project: 'myapp',
      branch: 'main',
      startTime: '09:00',
      endTime: '10:00',
      durationMinutes: 60,
      events: events.map((e) => ({ ...e, metadata: e.metadata ?? {}, exitCode: 0, durationMs: null })),
    }],
  })

  it('excludes server_run from the payload', () => {
    const msg = buildUserMessage(makePayload([
      { category: 'server_run', metadata: { tool: 'npm', script: 'dev' } },
      { category: 'code_commit', metadata: { message: 'feat: init' } },
    ]))
    expect(msg).not.toContain('server_run')
    expect(msg).toContain('code_commit')
  })

  it('excludes git_other from the payload', () => {
    const msg = buildUserMessage(makePayload([
      { category: 'git_other', metadata: { subcommand: 'status' } },
      { category: 'git_other', metadata: { subcommand: 'log' } },
      { category: 'code_commit', metadata: { message: 'fix: bug' } },
    ]))
    expect(msg).not.toContain('git_other')
    expect(msg).toContain('code_commit')
  })

  it('excludes environment, code_search, and code_read', () => {
    const msg = buildUserMessage(makePayload([
      { category: 'environment', metadata: { variable: 'NODE_ENV' } },
      { category: 'code_search', metadata: { tool: 'grep' } },
      { category: 'code_read', metadata: { tool: 'cat' } },
      { category: 'code_commit', metadata: { message: 'chore: update config' } },
    ]))
    expect(msg).not.toContain('environment')
    expect(msg).not.toContain('code_search')
    expect(msg).not.toContain('code_read')
    expect(msg).toContain('code_commit')
  })

  it('includes file_ops in the payload', () => {
    const msg = buildUserMessage(makePayload([
      { category: 'file_ops', metadata: { tool: 'mkdir' } },
      { category: 'code_commit', metadata: { message: 'feat: add components dir' } },
    ]))
    expect(msg).toContain('file_ops')
  })

  it('includes code_push in the payload', () => {
    const msg = buildUserMessage(makePayload([
      { category: 'code_commit', metadata: { message: 'fix: bug' } },
      { category: 'code_push', metadata: { remote: 'origin', branch: 'main' } },
    ]))
    expect(msg).toContain('code_push')
  })
})
