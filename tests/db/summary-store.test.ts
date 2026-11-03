import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { getSummaryBySource, mapSummary, saveAnchoredSummary } from '../../src/db/summary-store'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const KEY = 'api|2026-10-28T09:00:00.000Z'
const ANCHOR = { projectId: 4, firstEventId: 7, lastEventId: 9, isMixed: false }

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  return db
}

const record = (overrides: Partial<Parameters<typeof mapSummary>[1]> = {}) => ({
  sourceKey: KEY,
  engine: 'skill' as const,
  text: 'Fixed the token refresh race',
  createdAt: '2026-10-28T10:00:00.000Z',
  anchor: ANCHOR,
  anchorSource: 'thread' as const,
  ...overrides,
})

describe('summary-store', () => {
  it('saves only the anchored row, marked as saved, and never writes session_summaries', () => {
    const db = database()

    saveAnchoredSummary(db, record())

    expect(db.prepare('SELECT COUNT(*) AS count FROM session_summaries').get()).toEqual({ count: 0 })
    expect(getSummaryBySource(db, KEY, 'skill')).toMatchObject({
      scope: 'session',
      project_id: 4,
      first_event_id: 7,
      last_event_id: 9,
      text: 'Fixed the token refresh race',
      origin: 'saved',
      anchor_source: 'thread',
      is_mixed: 0,
    })
  })

  it('refuses a second row for the same key and engine', () => {
    const db = database()
    saveAnchoredSummary(db, record())
    const insert = () =>
      db
        .prepare(
          "INSERT INTO summary (scope, engine, text, created_at, source_key, origin, anchor_source) VALUES ('session', 'skill', 'x', 'y', ?, 'mapped', 'none')"
        )
        .run(KEY)

    expect(insert).toThrow(/UNIQUE/)
  })

  it('turns a mapped row into a saved one when the summary is saved again', () => {
    const db = database()
    mapSummary(
      db,
      record({ text: 'old text', anchor: { projectId: null, firstEventId: 1, lastEventId: 2, isMixed: false } })
    )

    saveAnchoredSummary(db, record({ text: 'new text' }))

    expect(getSummaryBySource(db, KEY, 'skill')).toMatchObject({ origin: 'saved', text: 'new text', first_event_id: 7 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM summary').get()).toEqual({ count: 1 })
  })

  it("never changes a saved row's range or text when mapping, only fills in its missing project", () => {
    const db = database()
    saveAnchoredSummary(db, record({ anchor: { projectId: null, firstEventId: 7, lastEventId: 9, isMixed: false } }))

    mapSummary(
      db,
      record({ text: 'rebuilt', anchor: { projectId: 4, firstEventId: 1, lastEventId: 2, isMixed: false } })
    )

    expect(getSummaryBySource(db, KEY, 'skill')).toMatchObject({
      origin: 'saved',
      text: 'Fixed the token refresh race',
      first_event_id: 7,
      last_event_id: 9,
      project_id: 4,
    })
  })

  it('rebuilds a mapped row in place', () => {
    const db = database()
    mapSummary(db, record({ anchor: { projectId: null, firstEventId: null, lastEventId: null, isMixed: false } }))

    mapSummary(db, record())

    expect(getSummaryBySource(db, KEY, 'skill')).toMatchObject({ origin: 'mapped', first_event_id: 7 })
  })
})
