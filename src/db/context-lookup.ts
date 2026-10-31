import path from 'path'
import type { MigrationDatabase } from './migration-types'
import type { SummaryRow } from './summary-store'
import { relativeInside, resolvedPath } from '../utils/working-directory'

// What `context` looks up on the thread path: the event to answer from, the block it's in, and what's stored about
// that block. `node:sqlite`-free, so tests run it on an in-memory database.

export interface EventPoint {
  id: number
  capturedAt: string
}

export interface WorkBlockRow {
  id: number
  date: string
  startedAt: string
  endedAt: string
  activeSlots: number
}

function latestOf(points: (EventPoint | null | undefined)[]): EventPoint | null {
  const found = points.filter((point): point is EventPoint => point !== null && point !== undefined)
  found.sort((first, second) => second.capturedAt.localeCompare(first.capturedAt) || second.id - first.id)
  return found[0] ?? null
}

/** The latest save of the file as its path was stored. */
function latestSaveByPath(db: MigrationDatabase, filePath: string): EventPoint | undefined {
  return db
    .prepare(
      `SELECT id, captured_at AS capturedAt FROM events
       WHERE file_path = ? AND category = 'code_edit' ORDER BY captured_at DESC, id DESC LIMIT 1`
    )
    .get(filePath) as EventPoint | undefined
}

// How many of a project file's saves to look through for one made in this very file
const PROJECT_FILE_SAVES_SCANNED = 200

/** Every project file the path could be: the file's path inside each stored checkout root that holds it. */
function projectFilesAt(db: MigrationDatabase, filePath: string): { projectId: number; relativePath: string }[] {
  const roots = db.prepare('SELECT project_id AS projectId, path FROM project_path').all() as {
    projectId: number
    path: string
  }[]
  return roots.flatMap((root) => {
    const relativePath = relativeInside(root.path, filePath)
    return relativePath ? [{ projectId: root.projectId, relativePath }] : []
  })
}

/**
 * The latest save linked to the file through its project's file — so a save stored under another path to the same
 * file (a symlink) still counts. A project spans every clone and worktree of its repo, so a save only counts when its
 * stored path is the same file on disk: `README.md` saved in another worktree is another file.
 */
function latestSaveByProjectFile(db: MigrationDatabase, filePath: string): EventPoint | null {
  const savesOfFile = db.prepare(
    `SELECT events.id, events.captured_at AS capturedAt, events.file_path AS filePath FROM file
     JOIN event_file ON event_file.file_id = file.id JOIN events ON events.id = event_file.event_id
     WHERE file.project_id = ? AND file.relative_path = ?
     ORDER BY events.captured_at DESC, events.id DESC LIMIT ${PROJECT_FILE_SAVES_SCANNED}`
  )
  const fileOnDisk = resolvedPath(filePath)
  const isThisFile = (storedPath: string | null) => storedPath !== null && resolvedPath(storedPath) === fileOnDisk
  return latestOf(
    projectFilesAt(db, filePath).map((projectFile) => {
      const rows = savesOfFile.all(projectFile.projectId, projectFile.relativePath) as (EventPoint & {
        filePath: string | null
      })[]
      const save = rows.find((row) => isThisFile(row.filePath))
      return save && { id: save.id, capturedAt: save.capturedAt }
    })
  )
}

/** The file's latest save: by the path it was stored under, or through its project's file. Null when never saved. */
export function findLatestFileSave(db: MigrationDatabase, filePath: string): EventPoint | null {
  return latestOf([latestSaveByPath(db, filePath), latestSaveByProjectFile(db, filePath)])
}

/** The latest event of the project with this identity (`idx_events_project_time`). Null when it has none. */
export function findLatestProjectEvent(db: MigrationDatabase, identity: string): EventPoint | null {
  const row = db
    .prepare(
      `SELECT events.id, events.captured_at AS capturedAt FROM events
       WHERE events.project_id = (SELECT id FROM project WHERE identity = ?)
       ORDER BY events.captured_at DESC, events.id DESC LIMIT 1`
    )
    .get(identity) as EventPoint | undefined
  return row ?? null
}

export function getWorkBlock(db: MigrationDatabase, blockId: number): WorkBlockRow | null {
  const row = db
    .prepare(
      `SELECT id, date, started_at AS startedAt, ended_at AS endedAt, active_slots AS activeSlots
       FROM work_block WHERE id = ?`
    )
    .get(blockId) as WorkBlockRow | undefined
  return row ?? null
}

/** The anchored summaries whose range starts in this block — the ones that can belong to one of its threads. */
export function getAnchoredSummariesInBlock(db: MigrationDatabase, eventIds: number[]): SummaryRow[] {
  return db
    .prepare('SELECT * FROM summary WHERE first_event_id IN (SELECT value FROM json_each(?)) ORDER BY id')
    .all(JSON.stringify(eventIds)) as SummaryRow[]
}

/**
 * Each project's name, by id: its latest name, else the newest name its events were stored under, else an alias,
 * else its checkout's folder — a project the upgrade only reached through a file save has no name of its own.
 */
export function getProjectNames(db: MigrationDatabase, projectIds: number[]): Map<number, string | null> {
  const rows = db
    .prepare(
      `SELECT project.id,
              COALESCE(
                project.name,
                (SELECT repo_name FROM events WHERE events.project_id = project.id AND repo_name IS NOT NULL
                 ORDER BY captured_at DESC LIMIT 1),
                (SELECT name FROM project_alias WHERE project_alias.project_id = project.id ORDER BY name LIMIT 1)
              ) AS name,
              (SELECT path FROM project_path WHERE project_path.project_id = project.id ORDER BY path LIMIT 1) AS root
       FROM project WHERE project.id IN (SELECT value FROM json_each(?))`
    )
    .all(JSON.stringify(projectIds)) as { id: number; name: string | null; root: string | null }[]
  return new Map(rows.map((row) => [row.id, row.name ?? (row.root === null ? null : path.basename(row.root))]))
}
