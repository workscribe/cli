import type { MigrationDatabase } from './migration-types'
import type { ProjectKind } from '../capture/project-identity'

// The project, branch and file rows events link to (migration 008). Insert-or-ignore throughout, so capture and the
// backfill job can both write them, in any order, any number of times. `node:sqlite`-free, so tests run it in memory.

/** What an event did to a file. An editor save is the one file action captured today. */
export type FileAction = 'save'

export const FILE_SAVE_ACTION: FileAction = 'save'

export interface ProjectRecord {
  identity: string
  kind: ProjectKind
  /** The name the event was stored under: kept as an alias, and as the project's latest name */
  name: string | null
  /** The checkout or worktree root the event came from, when git said */
  root: string | null
}

/** What an event links to. Resolved before the event is written; every part may be missing. */
export interface EventDimensions {
  project: ProjectRecord | null
  /** The event's branch, when it's a branch of `project` */
  branch: string | null
  /** The file the event was about, relative to the project's root */
  file: { relativePath: string; action: FileAction } | null
}

/** The project's id, creating it if needed, and records the name and root it was seen under. */
export function upsertProject(db: MigrationDatabase, project: ProjectRecord): number {
  const row = db
    .prepare(
      `INSERT INTO project (identity, kind, name) VALUES ($identity, $kind, $name)
       ON CONFLICT (identity) DO UPDATE SET name = COALESCE(excluded.name, project.name)
       RETURNING id`
    )
    .get({ identity: project.identity, kind: project.kind, name: project.name }) as { id: number }
  if (project.name !== null) {
    db.prepare('INSERT OR IGNORE INTO project_alias (project_id, name) VALUES (?, ?)').run(row.id, project.name)
  }
  if (project.root !== null) {
    db.prepare('INSERT OR IGNORE INTO project_path (project_id, path) VALUES (?, ?)').run(row.id, project.root)
  }
  return row.id
}

export function upsertBranch(db: MigrationDatabase, projectId: number, name: string): number {
  db.prepare('INSERT OR IGNORE INTO branch (project_id, name) VALUES (?, ?)').run(projectId, name)
  const row = db.prepare('SELECT id FROM branch WHERE project_id = ? AND name = ?').get(projectId, name) as {
    id: number
  }
  return row.id
}

export function upsertFile(db: MigrationDatabase, projectId: number, relativePath: string): number {
  db.prepare('INSERT OR IGNORE INTO file (project_id, relative_path) VALUES (?, ?)').run(projectId, relativePath)
  const row = db
    .prepare('SELECT id FROM file WHERE project_id = ? AND relative_path = ?')
    .get(projectId, relativePath) as { id: number }
  return row.id
}

export function linkEventFile(
  db: MigrationDatabase,
  link: { eventId: number; fileId: number; action: FileAction }
): void {
  db.prepare('INSERT OR IGNORE INTO event_file (event_id, file_id, action) VALUES (?, ?, ?)').run(
    link.eventId,
    link.fileId,
    link.action
  )
}

/** Links a stored event to its project, branch and file. Without a project, nothing is linked. */
export function writeEventDimensions(db: MigrationDatabase, eventId: number, dimensions: EventDimensions): void {
  if (dimensions.project === null) return
  const projectId = upsertProject(db, dimensions.project)
  const branchId = dimensions.branch === null ? null : upsertBranch(db, projectId, dimensions.branch)
  db.prepare('UPDATE events SET project_id = ?, branch_id = ? WHERE id = ?').run(projectId, branchId, eventId)
  if (dimensions.file === null) return
  const fileId = upsertFile(db, projectId, dimensions.file.relativePath)
  linkEventFile(db, { eventId, fileId, action: dimensions.file.action })
}
