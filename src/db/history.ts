import type { MigrationDatabase } from './migration-types'
import type { EventRow } from './types'

// What `history` reads. `node:sqlite`-free, so tests run it on an in-memory database.

/**
 * The events of the project with this identity since the bound, oldest first (`idx_events_project_time`). A project
 * spans every checkout and worktree of the repo; events not linked to a project yet are not in it.
 */
export function getProjectEventsSince(db: MigrationDatabase, identity: string, sinceIso: string): EventRow[] {
  return db
    .prepare(
      `SELECT events.* FROM events
       WHERE events.project_id = (SELECT id FROM project WHERE identity = ?) AND events.captured_at >= ?
       ORDER BY events.captured_at, events.id`
    )
    .all(identity, sinceIso) as unknown as EventRow[]
}
