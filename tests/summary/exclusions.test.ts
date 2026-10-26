import { describe, it, expect } from 'vitest'
import { buildExcludedSet, countExcludedEvents } from '../../src/summary/exclusions'
import type { EventPayload, SessionPayload } from '../../src/ai/types'

function session(categories: string[]): SessionPayload {
  const events: EventPayload[] = categories.map((category) => ({
    category,
    metadata: {},
    exitCode: 0,
    durationMs: null,
  }))
  return {
    date: '2026-10-26',
    project: 'api',
    branch: null,
    startTime: '09:00',
    endTime: '10:00',
    durationMinutes: 60,
    events,
  }
}

describe('countExcludedEvents', () => {
  it('counts each excluded category across sessions', () => {
    const sessions = [session(['exploring', 'shipping', 'linting']), session(['exploring'])]

    expect(countExcludedEvents(sessions, buildExcludedSet())).toEqual(
      new Map([
        ['exploring', 2],
        ['linting', 1],
      ])
    )
  })

  it('counts nothing for a category the user re-included', () => {
    expect(countExcludedEvents([session(['linting'])], buildExcludedSet(['linting'])).size).toBe(0)
  })
})
