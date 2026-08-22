import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/profiles/loader', () => ({
  getActiveProfileAiContexts: vi.fn().mockReturnValue([]),
}))

import { buildWeeklyMessage, buildUserMessage, SYSTEM_PROMPT, getSystemPrompt } from '../../src/ai/prompt'
import { getActiveProfileAiContexts } from '../../src/profiles/loader'
import type { WeekSummaryPayload, DaySummaryPayload } from '../../src/ai/types'

const mockGetActiveProfileAiContexts = getActiveProfileAiContexts as ReturnType<typeof vi.fn>

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
            { category: 'shipping', metadata: { message: 'fix: auth' }, exitCode: 0, durationMs: null },
            { category: 'testing', metadata: {}, exitCode: 0, durationMs: null },
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
            { category: 'building', metadata: {}, exitCode: 0, durationMs: null },
            { category: 'building', metadata: {}, exitCode: 0, durationMs: null },
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
    expect(buildWeeklyMessage(TWO_DAY_PAYLOAD)).toContain('2x building')
  })

  it('does not prefix single events with count', () => {
    const msg = buildWeeklyMessage(TWO_DAY_PAYLOAD)
    expect(msg).toContain('testing')
    expect(msg).not.toContain('1x testing')
  })

  it('skips days not present in the payload', () => {
    const payload: WeekSummaryPayload = {
      weekStart: '2026-05-25',
      weekEnd: '2026-05-27',
      days: [TWO_DAY_PAYLOAD.days[0]],
    }
    expect(buildWeeklyMessage(payload)).not.toContain('Tuesday')
  })

  it('excludes exploring events', () => {
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
                { category: 'exploring', metadata: { tool: 'grep' }, exitCode: 0, durationMs: null },
                { category: 'shipping', metadata: { message: 'fix: bug' }, exitCode: 0, durationMs: null },
              ],
            },
          ],
        },
      ],
    }
    const msg = buildWeeklyMessage(payload)
    expect(msg).not.toContain('exploring')
    expect(msg).toContain('shipping')
  })
})

// ─── buildUserMessage ─────────────────────────────────────────────────────────

const makePayload = (
  events: { category: string; metadata?: Record<string, unknown>; hint?: string }[]
): DaySummaryPayload => ({
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
  it('excludes exploring events (grep, find, cat)', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'exploring', metadata: { tool: 'grep' } },
        { category: 'shipping', metadata: { message: 'feat: init' } },
      ])
    )
    expect(msg).not.toContain('exploring')
    expect(msg).toContain('shipping')
  })

  it('includes running events', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'running', metadata: { tool: 'npm', script: 'dev' } },
        { category: 'shipping', metadata: { message: 'fix: bug' } },
      ])
    )
    expect(msg).toContain('running')
    expect(msg).toContain('shipping')
  })

  it('includes versioning events', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'versioning', metadata: { subcommand: 'status' } },
        { category: 'shipping', metadata: { message: 'fix: bug' } },
      ])
    )
    expect(msg).toContain('versioning')
    expect(msg).toContain('shipping')
  })

  it('includes dependencies events', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'dependencies', metadata: { tool: 'npm', packages: ['react'] } },
        { category: 'shipping', metadata: { message: 'feat: add react' } },
      ])
    )
    expect(msg).toContain('dependencies')
  })

  it('includes infrastructure events', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'infrastructure', metadata: { tool: 'kubectl', subcommand: 'apply' } },
        { category: 'shipping', metadata: { message: 'feat: deploy service' } },
      ])
    )
    expect(msg).toContain('infrastructure')
  })

  it('includes files events', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'files', metadata: { tool: 'mkdir' } },
        { category: 'shipping', metadata: { message: 'feat: add components dir' } },
      ])
    )
    expect(msg).toContain('files')
  })

  it('includes shipping events', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'shipping', metadata: { message: 'fix: bug' } },
        { category: 'shipping', metadata: { remote: 'origin', branch: 'main' } },
      ])
    )
    expect(msg).toContain('shipping')
  })

  it('renders other events with hint as other  [hint text]', () => {
    const msg = buildUserMessage(makePayload([{ category: 'other', metadata: {}, hint: 'nvm install v22.22.0' }]))
    expect(msg).toContain('other  [nvm install v22.22.0]')
  })

  it('renders other events without hint as plain other', () => {
    const msg = buildUserMessage(makePayload([{ category: 'other', metadata: {} }]))
    expect(msg).toContain('other')
    expect(msg).not.toContain('[')
  })

  it('appends [failed] to other events with hint', () => {
    const payload: DaySummaryPayload = {
      date: '2026-05-28',
      sessions: [
        {
          date: '2026-05-28',
          project: 'myapp',
          branch: 'main',
          startTime: '09:00',
          endTime: '10:00',
          durationMinutes: 60,
          events: [{ category: 'other', metadata: {}, hint: 'bad-cmd --flag', exitCode: 1, durationMs: null }],
        },
      ],
    }
    const msg = buildUserMessage(payload)
    expect(msg).toContain('other  [bad-cmd --flag] [failed]')
  })
})

// ─── SYSTEM_PROMPT ────────────────────────────────────────────────────────────

describe('note events in buildUserMessage', () => {
  it('renders a note before the event list as NOTE: <text>', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'note', metadata: { text: 'Fixed race condition in auth middleware' } },
        { category: 'shipping', metadata: { message: 'fix: auth' } },
      ])
    )
    expect(msg).toContain('NOTE: Fixed race condition in auth middleware')
    expect(msg).toContain('shipping')
  })

  it('excludes note events from the aggregated event list', () => {
    const msg = buildUserMessage(makePayload([{ category: 'note', metadata: { text: 'some context' } }]))
    expect(msg).not.toContain('note {"text"')
    expect(msg).not.toContain('1x note')
  })

  it('renders multiple notes in order', () => {
    const msg = buildUserMessage(
      makePayload([
        { category: 'note', metadata: { text: 'first note' } },
        { category: 'note', metadata: { text: 'second note' } },
      ])
    )
    const firstPos = msg.indexOf('NOTE: first note')
    const secondPos = msg.indexOf('NOTE: second note')
    expect(firstPos).toBeGreaterThanOrEqual(0)
    expect(secondPos).toBeGreaterThan(firstPos)
  })
})

describe('note events in buildWeeklyMessage', () => {
  it('renders a note under the session in the weekly message', () => {
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
                { category: 'note', metadata: { text: 'Blocked by infra outage' }, exitCode: null, durationMs: null },
                { category: 'shipping', metadata: { message: 'fix: retry' }, exitCode: 0, durationMs: null },
              ],
            },
          ],
        },
      ],
    }
    const msg = buildWeeklyMessage(payload)
    expect(msg).toContain('NOTE: Blocked by infra outage')
    expect(msg).toContain('shipping')
  })
})

describe('getSystemPrompt', () => {
  it('returns the base SYSTEM_PROMPT when no profiles are active', () => {
    mockGetActiveProfileAiContexts.mockReturnValue([])
    expect(getSystemPrompt()).toBe(SYSTEM_PROMPT)
  })

  it('appends a single profile aiContext to the base prompt', () => {
    mockGetActiveProfileAiContexts.mockReturnValue(['This developer works with Flutter and Dart.'])
    const result = getSystemPrompt()
    expect(result).toContain(SYSTEM_PROMPT)
    expect(result).toContain('This developer works with Flutter and Dart.')
  })

  it('appends multiple profile aiContext strings separated by newline', () => {
    mockGetActiveProfileAiContexts.mockReturnValue([
      'This developer works with Flutter and Dart.',
      'This developer uses Android tooling.',
    ])
    const result = getSystemPrompt()
    expect(result).toContain('Flutter and Dart')
    expect(result).toContain('Android tooling')
  })
})

describe('SYSTEM_PROMPT', () => {
  it('instructs the model to infer domain from package names', () => {
    expect(SYSTEM_PROMPT).toContain('infer the purpose from package names')
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
