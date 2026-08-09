import { describe, it, expect } from 'vitest'
import { splitByIdleGap, splitByRepo, minutesBetween } from '../../src/sessions/grouper'
import type { EventRow } from '../../src/db/types'

// Factory: build a minimal EventRow for testing
function makeEvent(overrides: Partial<EventRow> & { captured_at: string }): EventRow {
  return {
    id: Math.floor(Math.random() * 10000),
    captured_at: overrides.captured_at,
    command: overrides.command ?? 'npm test',
    cwd: overrides.cwd ?? '/projects/myapp',
    exit_code: overrides.exit_code ?? 0,
    duration_ms: overrides.duration_ms ?? 500,
    repo_name: overrides.repo_name ?? 'myapp',
    branch: overrides.branch ?? 'main',
    category: overrides.category ?? 'test_run',
    metadata: overrides.metadata ?? null,
  }
}

// Build an ISO timestamp offset from a base time by N minutes
function at(baseMs: number, offsetMinutes: number): string {
  return new Date(baseMs + offsetMinutes * 60 * 1000).toISOString()
}

const BASE = new Date('2026-05-23T09:00:00Z').getTime()
const IDLE_30_MIN_MS = 30 * 60 * 1000

describe('splitByIdleGap', () => {
  it('returns empty array for empty input', () => {
    expect(splitByIdleGap([], IDLE_30_MIN_MS)).toEqual([])
  })

  it('returns one group when all events are within the idle window', () => {
    const events = [
      makeEvent({ captured_at: at(BASE, 0) }),
      makeEvent({ captured_at: at(BASE, 5) }),
      makeEvent({ captured_at: at(BASE, 10) }),
    ]
    const groups = splitByIdleGap(events, IDLE_30_MIN_MS)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(3)
  })

  it('splits into two groups when gap exceeds idle threshold', () => {
    const events = [
      makeEvent({ captured_at: at(BASE, 0) }),
      makeEvent({ captured_at: at(BASE, 10) }),
      // 45-minute gap — exceeds 30-min threshold
      makeEvent({ captured_at: at(BASE, 55) }),
      makeEvent({ captured_at: at(BASE, 60) }),
    ]
    const groups = splitByIdleGap(events, IDLE_30_MIN_MS)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveLength(2)
    expect(groups[1]).toHaveLength(2)
  })

  it('splits into three groups with two separate gaps', () => {
    const events = [
      makeEvent({ captured_at: at(BASE, 0) }),
      makeEvent({ captured_at: at(BASE, 45) }), // gap 1
      makeEvent({ captured_at: at(BASE, 90) }), // gap 2
    ]
    const groups = splitByIdleGap(events, IDLE_30_MIN_MS)
    expect(groups).toHaveLength(3)
  })

  it('treats a single event as its own group', () => {
    const events = [makeEvent({ captured_at: at(BASE, 0) })]
    const groups = splitByIdleGap(events, IDLE_30_MIN_MS)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toHaveLength(1)
  })

  it('splits exactly at the threshold boundary', () => {
    const events = [
      makeEvent({ captured_at: at(BASE, 0) }),
      makeEvent({ captured_at: at(BASE, 30) }), // exactly 30 min = new group
    ]
    const groups = splitByIdleGap(events, IDLE_30_MIN_MS)
    expect(groups).toHaveLength(2)
  })

  it('does not split when gap is 1ms under threshold', () => {
    const edgeMs = IDLE_30_MIN_MS - 1
    const events = [
      makeEvent({ captured_at: new Date(BASE).toISOString() }),
      makeEvent({ captured_at: new Date(BASE + edgeMs).toISOString() }),
    ]
    const groups = splitByIdleGap(events, IDLE_30_MIN_MS)
    expect(groups).toHaveLength(1)
  })

  it('respects custom idle threshold', () => {
    const fiveMinMs = 5 * 60 * 1000
    const events = [
      makeEvent({ captured_at: at(BASE, 0) }),
      makeEvent({ captured_at: at(BASE, 6) }), // 6 min gap > 5 min threshold
    ]
    const groups = splitByIdleGap(events, fiveMinMs)
    expect(groups).toHaveLength(2)
  })
})

describe('splitByRepo', () => {
  it('returns empty array for empty input', () => {
    expect(splitByRepo([])).toEqual([])
  })

  it('returns one group when all events share the same repo', () => {
    const events = [
      makeEvent({ captured_at: at(BASE, 0), repo_name: 'api' }),
      makeEvent({ captured_at: at(BASE, 5), repo_name: 'api' }),
      makeEvent({ captured_at: at(BASE, 10), repo_name: 'api' }),
    ]
    expect(splitByRepo(events)).toHaveLength(1)
  })

  it('splits on repo change', () => {
    const events = [
      makeEvent({ captured_at: at(BASE, 0), repo_name: 'api' }),
      makeEvent({ captured_at: at(BASE, 5), repo_name: 'api' }),
      makeEvent({ captured_at: at(BASE, 10), repo_name: 'frontend' }),
      makeEvent({ captured_at: at(BASE, 15), repo_name: 'frontend' }),
    ]
    const groups = splitByRepo(events)
    expect(groups).toHaveLength(2)
    expect(groups[0].every((event) => event.repo_name === 'api')).toBe(true)
    expect(groups[1].every((event) => event.repo_name === 'frontend')).toBe(true)
  })

  it('creates a new group when switching back to a previous repo', () => {
    const events = [
      makeEvent({ captured_at: at(BASE, 0), repo_name: 'api' }),
      makeEvent({ captured_at: at(BASE, 5), repo_name: 'frontend' }),
      makeEvent({ captured_at: at(BASE, 10), repo_name: 'api' }), // back to api
    ]
    const groups = splitByRepo(events)
    expect(groups).toHaveLength(3)
  })

  it('handles null repo_name — groups nulls consecutively', () => {
    const events = [
      makeEvent({ captured_at: at(BASE, 0), repo_name: null }),
      makeEvent({ captured_at: at(BASE, 5), repo_name: null }),
      makeEvent({ captured_at: at(BASE, 10), repo_name: 'api' }),
    ]
    const groups = splitByRepo(events)
    expect(groups).toHaveLength(2)
    expect(groups[0]).toHaveLength(2)
  })

  it('treats null → non-null as a split', () => {
    const events = [
      makeEvent({ captured_at: at(BASE, 0), repo_name: null }),
      makeEvent({ captured_at: at(BASE, 5), repo_name: 'api' }),
    ]
    expect(splitByRepo(events)).toHaveLength(2)
  })
})

describe('minutesBetween', () => {
  it('returns 0 for same timestamps', () => {
    const ts = new Date().toISOString()
    expect(minutesBetween(ts, ts)).toBe(0)
  })

  it('returns correct minutes for a 1-hour gap', () => {
    const start = new Date('2026-05-23T09:00:00Z').toISOString()
    const end = new Date('2026-05-23T10:00:00Z').toISOString()
    expect(minutesBetween(start, end)).toBe(60)
  })

  it('returns correct minutes for a 90-minute gap', () => {
    const start = new Date('2026-05-23T09:00:00Z').toISOString()
    const end = new Date('2026-05-23T10:30:00Z').toISOString()
    expect(minutesBetween(start, end)).toBe(90)
  })

  it('returns fractional minutes for sub-minute gaps', () => {
    const start = new Date('2026-05-23T09:00:00Z').toISOString()
    const end = new Date('2026-05-23T09:00:30Z').toISOString()
    expect(minutesBetween(start, end)).toBeCloseTo(0.5)
  })
})
