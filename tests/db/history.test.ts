import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { insertEventRecord, type NewEvent } from '../../src/db/event-writer'
import { getProjectEventsSince } from '../../src/db/history'
import type { EventDimensions } from '../../src/db/dimensions'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  return db
}

const linked = (identity: string): EventDimensions => ({
  project: { identity, kind: 'git-remote', name: identity, root: `/code/${identity}` },
  branch: 'main',
  file: null,
})

function event(command: string, capturedAt: string, dimensions: EventDimensions | undefined): NewEvent {
  return {
    captured_at: capturedAt,
    command,
    cwd: '/code/api',
    exit_code: 0,
    duration_ms: 10,
    repo_name: 'api',
    branch: 'main',
    category: 'versioning',
    metadata: null,
    source: null,
    file_path: null,
    dimensions,
  }
}

describe('getProjectEventsSince', () => {
  it("returns the repo's events since the bound, oldest first, and no one else's", () => {
    const db = database()
    insertEventRecord(db, event('git commit', '2026-11-10T09:00:00.000Z', linked('api')))
    insertEventRecord(db, event('git status', '2026-11-10T08:00:00.000Z', linked('api')))
    insertEventRecord(db, event('git log', '2026-11-09T08:00:00.000Z', linked('api')))
    insertEventRecord(db, event('git pull', '2026-11-10T08:30:00.000Z', linked('web')))
    insertEventRecord(db, event('git fetch', '2026-11-10T08:40:00.000Z', undefined))

    const rows = getProjectEventsSince(db, 'api', '2026-11-10T00:00:00.000Z')

    expect(rows.map((row) => row.command)).toEqual(['git status', 'git commit'])
  })

  it('is empty for a repo with no project yet', () => {
    expect(getProjectEventsSince(database(), 'nobody', '2026-11-10T00:00:00.000Z')).toEqual([])
  })
})
