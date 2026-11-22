import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { countEventsUnderFolder } from '../../src/db/path-events'

vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

function databaseWith(events: { cwd: string; filePath?: string }[]): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  applyMigrations(db, MIGRATIONS)
  const insert = db.prepare(
    `INSERT INTO events (captured_at, command, cwd, category, file_path) VALUES ('2026-11-09T10:00:00.000Z', 'x', ?, 'other', ?)`
  )
  for (const event of events) insert.run(event.cwd, event.filePath ?? null)
  return db
}

describe('countEventsUnderFolder', () => {
  const db = databaseWith([
    { cwd: '/w/client' },
    { cwd: '/w/client/src' },
    { cwd: '/w/client-old' },
    { cwd: '/w', filePath: '/w/client/app.ts' },
    { cwd: '/w', filePath: '/w/client-old/app.ts' },
    { cwd: '/w/cl_ent' },
    { cwd: '/w/other' },
  ])

  it('counts the folder, below it and edits to files under it, never a sibling', () => {
    expect(countEventsUnderFolder(db, '/w/client')).toBe(3)
  })

  it('takes _ and % in a folder name as themselves', () => {
    expect(countEventsUnderFolder(db, '/w/cl_ent')).toBe(1)
    expect(countEventsUnderFolder(db, '/w/cl%')).toBe(0)
  })

  it('is zero when nothing was recorded there', () => {
    expect(countEventsUnderFolder(db, '/nowhere')).toBe(0)
  })
})
