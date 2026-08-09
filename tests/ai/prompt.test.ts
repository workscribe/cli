import { describe, it, expect } from 'vitest'
import { buildWeeklyMessage, buildUserMessage, SYSTEM_PROMPT } from '../../src/ai/prompt'
import type { WeekSummaryPayload, DaySummaryPayload } from '../../src/ai/types'

// ─── buildWeeklyMessage ───────────────────────────────────────────────────────

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
    expect(buildWeeklyMessage(TWO_DAY_PAYLOAD)).toContain('Week: 2026-05-25 to 2026-05-26')
  })

  it('includes day names with dates', () => {
    const msg = buildWeeklyMessage(TWO_DAY_PAYLOAD)
    expect(msg).toContain('Monday 2026-05-25')
    expect(msg).toContain('Tuesday 2026-05-26')
  })

  it('includes project and branch', () => {
    expect(buildWeeklyMessage(TWO_DAY_PAYLOAD)).toContain('api-service (feature/auth)')
  })

  it('omits branch when null', () => {
    const msg = buildWeeklyMessage(TWO_DAY_PAYLOAD)
    expect(msg).toContain('Project: dashboard —')
    expect(msg).not.toContain('dashboard (null)')
  })

  it('aggregates repeated events', () => {
    expect(buildWeeklyMessage(TWO_DAY_PAYLOAD)).toContain('2x build')
  })

  it('does not prefix single events with count', () => {
    const msg = buildWeeklyMessage(TWO_DAY_PAYLOAD)
    expect(msg).toContain('test_run')
    expect(msg).not.toContain('1x test_run')
  })

  it('skips days not present in the payload', () => {
    const payload: WeekSummaryPayload = {
      weekStart: '2026-05-25',
      weekEnd: '2026-05-27',
      days: [TWO_DAY_PAYLOAD.days[0]],
    }
    expect(buildWeeklyMessage(payload)).not.toContain('Tuesday')
  })

  it('excludes server_run and git_other', () => {
    const payload: WeekSummaryPayload = {
      weekStart: '2026-05-25',
      weekEnd: '2026-05-25',
      days: [
        {
          date: '2026-05-25',
          sessions: [
            {
              date: '2026-05-25',
              project: 'api-service',
              branch: 'main',
              startTime: '09:00',
              endTime: '10:00',
              durationMinutes: 60,
              events: [
                { category: 'server_run', metadata: { tool: 'npm' }, exitCode: 0, durationMs: null },
                { category: 'git_other', metadata: { subcommand: 'status' }, exitCode: 0, durationMs: null },
                { category: 'code_commit', metadata: { message: 'fix: bug' }, exitCode: 0, durationMs: null },
              ],
            },
          ],
        },
      ],
    }
    const msg = buildWeeklyMessage(payload)
    expect(msg).not.toContain('server_run')
    expect(msg).not.toContain('git_other')
    expect(msg).toContain('code_commit')
  })
})

// ─── buildUserMessage ─────────────────────────────────────────────────────────

const makePayload = (events: { category: string; metadata?: Record<string, unknown> }[]): DaySummaryPayload => ({
  date: '2026-05-28',
  sessions: [
    {
      date: '2026-05-28',
      project: 'myapp',
      branch: 'main',
      startTime: '09:00',
      endTime: '10:00',
      durationMinutes: 60,
      events: events.map((event) => ({ ...event, metadata: event.metadata ?? {}, exitCode: 0, durationMs: null })),
    },
  ],
})

describe('buildUserMessage', () => {
  it('excludes server_run', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'server_run', metadata: { tool: 'npm', script: 'dev' } },
        { category: 'code_commit', metadata: { message: 'feat: init' } },
      ])
    )
    expect(msg).not.toContain('server_run')
    expect(msg).toContain('code_commit')
  })

  it('excludes git_other', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'git_other', metadata: { subcommand: 'status' } },
        { category: 'code_commit', metadata: { message: 'fix: bug' } },
      ])
    )
    expect(msg).not.toContain('git_other')
    expect(msg).toContain('code_commit')
  })

  it('excludes environment, code_search, and code_read', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'environment', metadata: { variable: 'NODE_ENV' } },
        { category: 'code_search', metadata: { tool: 'grep' } },
        { category: 'code_read', metadata: { tool: 'cat' } },
        { category: 'code_commit', metadata: { message: 'chore: update config' } },
      ])
    )
    expect(msg).not.toContain('environment')
    expect(msg).not.toContain('code_search')
    expect(msg).not.toContain('code_read')
    expect(msg).toContain('code_commit')
  })

  it('includes file_ops', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'file_ops', metadata: { tool: 'mkdir' } },
        { category: 'code_commit', metadata: { message: 'feat: add components dir' } },
      ])
    )
    expect(msg).toContain('file_ops')
  })

  it('includes code_push', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'code_commit', metadata: { message: 'fix: bug' } },
        { category: 'code_push', metadata: { remote: 'origin', branch: 'main' } },
      ])
    )
    expect(msg).toContain('code_push')
  })
})

// ─── SYSTEM_PROMPT ────────────────────────────────────────────────────────────

describe('SYSTEM_PROMPT', () => {
  it('instructs the model to infer domain from package names', () => {
    expect(SYSTEM_PROMPT).toContain('infer the purpose of packages from their names')
  })

  it('includes concrete package→domain examples', () => {
    expect(SYSTEM_PROMPT).toContain('bcrypt')
    expect(SYSTEM_PROMPT).toContain('authentication')
    expect(SYSTEM_PROMPT).toContain('prisma')
    expect(SYSTEM_PROMPT).toContain('database')
  })

  it('instructs the model not to guess for unfamiliar packages', () => {
    expect(SYSTEM_PROMPT).toContain('unfamiliar packages')
  })
})
