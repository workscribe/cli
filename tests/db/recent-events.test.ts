import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { countOtherEventsSince, countOtherEventTools, sinceIso } from '../../src/db/recent-events'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const NOW = Date.parse('2026-11-09T10:00:00.000Z')

function databaseWith(events: { capturedAt: string; category: string }[]): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db, MIGRATIONS)
  const insert = db.prepare(
    `INSERT INTO events (captured_at, command, cwd, category, metadata) VALUES (?, 'make deploy', '/repo', ?, '{"tool":"make"}')`
  )
  for (const event of events) insert.run(event.capturedAt, event.category)
  return db
}

describe('sinceIso', () => {
  it('is the moment the window starts, in the format captured_at is stored in', () => {
    expect(sinceIso(7, NOW)).toBe('2026-11-02T10:00:00.000Z')
  })
})

describe('the last days of events', () => {
  // On the boundary day: one before the cutoff (10:00), one after
  const db = databaseWith([
    { capturedAt: '2026-11-02T09:00:00.000Z', category: 'other' },
    { capturedAt: '2026-11-02T11:00:00.000Z', category: 'other' },
    { capturedAt: '2026-11-08T12:00:00.000Z', category: 'testing' },
  ])

  it("leaves out the boundary day's events from before the cutoff", () => {
    expect(countOtherEventsSince(db, sinceIso(7, NOW))).toEqual({ total: 2, otherCount: 1 })
  })

  it('counts the unclassified tools in the window only', () => {
    expect(countOtherEventTools(db, sinceIso(7, NOW))).toEqual([{ tool: 'make', count: 1 }])
  })
})
