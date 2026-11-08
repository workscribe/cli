import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { mergeIntoRecentEdit, type RecentEdit } from '../../src/db/edit-merge'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const FILE = '/code/cli/src/a.ts'
const CWD = '/code/cli'
const FIRST_EDIT_AT = '2026-11-07T10:00:00.000Z'
const WINDOW_MS = 30_000

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db, MIGRATIONS)
  return db
}

function storeEvent(
  db: DatabaseSync,
  event: { category?: string; source?: string | null; capturedAt?: string; metadata?: string | null } = {}
): void {
  db.prepare(
    `INSERT INTO events (captured_at, command, cwd, category, metadata, source, file_path)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    event.capturedAt ?? FIRST_EDIT_AT,
    FILE,
    CWD,
    event.category ?? 'code_edit',
    event.metadata === undefined ? '{"linesAdded":3,"linesRemoved":1}' : event.metadata,
    event.source === undefined ? 'vscode' : event.source,
    FILE
  )
}

function edit(overrides: Partial<RecentEdit> = {}): RecentEdit {
  return {
    filePath: FILE,
    cwd: CWD,
    source: 'vscode',
    counts: { linesAdded: 3, linesRemoved: 1 },
    editedAt: '2026-11-07T10:00:20.000Z',
    windowMs: WINDOW_MS,
    ...overrides,
  }
}

function storedEvents(db: DatabaseSync): { captured_at: string; metadata: string | null }[] {
  return db.prepare('SELECT captured_at, metadata FROM events ORDER BY id').all() as {
    captured_at: string
    metadata: string | null
  }[]
}

describe('mergeIntoRecentEdit', () => {
  it('adds a repeated edit to the earlier one and keeps its time', () => {
    const db = database()
    storeEvent(db)

    expect(mergeIntoRecentEdit(db, edit())).toBe(true)

    const [stored] = storedEvents(db)
    expect(storedEvents(db)).toHaveLength(1)
    expect(stored.captured_at).toBe(FIRST_EDIT_AT)
    expect(JSON.parse(stored.metadata ?? '')).toEqual({
      linesAdded: 6,
      linesRemoved: 2,
      lastEditAt: '2026-11-07T10:00:20.000Z',
    })
  })

  it("closes the window from the event's own time, however recent its last edit", () => {
    const db = database()
    storeEvent(db, { metadata: '{"linesAdded":3,"linesRemoved":1,"lastEditAt":"2026-11-07T10:00:29.000Z"}' })

    expect(mergeIntoRecentEdit(db, edit({ editedAt: '2026-11-07T10:00:31.000Z' }))).toBe(false)
  })

  it('never merges an edit from another source', () => {
    const db = database()
    storeEvent(db, { source: 'claude-code' })

    expect(mergeIntoRecentEdit(db, edit())).toBe(false)
    expect(JSON.parse(storedEvents(db)[0].metadata ?? '')).toEqual({ linesAdded: 3, linesRemoved: 1 })
  })

  it('merges edits that both came without a source', () => {
    const db = database()
    storeEvent(db, { source: null })

    expect(mergeIntoRecentEdit(db, edit({ source: null }))).toBe(true)
  })

  it("doesn't merge when the file's latest event isn't an edit", () => {
    const db = database()
    storeEvent(db)
    storeEvent(db, { category: 'debug_start', metadata: null, capturedAt: '2026-11-07T10:00:10.000Z' })

    expect(mergeIntoRecentEdit(db, edit())).toBe(false)
  })

  it('finds nothing to merge into for a file never edited here', () => {
    expect(mergeIntoRecentEdit(database(), edit())).toBe(false)
  })

  it('adds onto a save stored before line counts', () => {
    const db = database()
    storeEvent(db, { metadata: null })

    expect(mergeIntoRecentEdit(db, edit())).toBe(true)
    expect(JSON.parse(storedEvents(db)[0].metadata ?? '')).toMatchObject({ linesAdded: 3, linesRemoved: 1 })
  })
})
