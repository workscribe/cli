import type { MigrationDatabase } from '../migration-types'
import { FALLBACK_METHODS, type ResolutionMethod } from './project-resolution'
import type { JobIssue, JobVerification } from './types'

// What the project-dimensions job reports: the guesses it made, as issues, and its verification.

/** The events there were when the job resolved every pair: the events it must link, and the count it must keep. */
export interface GatherMark {
  throughId: number
  events: number
}

const METHOD_LABELS: Record<ResolutionMethod, string> = {
  git: 'git, at a folder that still exists',
  folder: 'a live checkout above a folder that is gone',
  'qualified-name': 'their owner/repo name',
  'bare-name': 'a bare name a live repo was also stored under',
  name: 'their name alone (no live repo matched)',
  none: 'nothing: captured outside a repo',
}

function eventCount(count: number): string {
  return `${count} event${count === 1 ? '' : 's'}`
}

export function fallbackReason(method: ResolutionMethod, count: number, identity: string | null): string {
  if (method === 'name') return `${eventCount(count)}: no live repo matched, so kept as a project of its own by name`
  return `${eventCount(count)}: joined ${identity ?? 'a project'} by ${METHOD_LABELS[method]}`
}

/** One issue per pair that found its project by a fallback, so the upgrade's results show every guess it made. */
export function fallbackIssues(db: MigrationDatabase): JobIssue[] {
  const rows = db
    .prepare(
      `SELECT resolution.cwd, resolution.repo_name, resolution.method, resolution.event_count, project.identity
       FROM project_resolution resolution LEFT JOIN project ON project.id = resolution.project_id
       ORDER BY resolution.cwd, resolution.repo_name`
    )
    .all() as {
    cwd: string
    repo_name: string
    method: ResolutionMethod
    event_count: number
    identity: string | null
  }[]
  return rows
    .filter((row) => FALLBACK_METHODS.includes(row.method))
    .map((row) => ({
      reference: `${row.cwd} (${row.repo_name})`,
      reason: fallbackReason(row.method, row.event_count, row.identity),
    }))
}

function countRows(db: MigrationDatabase, sql: string, ...parameters: unknown[]): number {
  return (db.prepare(sql).get(...parameters) as { count: number }).count
}

function methodNotes(db: MigrationDatabase): string[] {
  const byMethod = db
    .prepare(
      `SELECT resolution.method, COUNT(*) AS count FROM events
       JOIN project_resolution resolution
         ON resolution.cwd = events.cwd AND resolution.repo_name = COALESCE(events.repo_name, '')
       GROUP BY resolution.method ORDER BY count DESC`
    )
    .all() as { method: ResolutionMethod; count: number }[]
  return byMethod.map((row) => `${eventCount(row.count)} matched by ${METHOD_LABELS[row.method]}`)
}

/**
 * Passes when every event with a name found a project, which the name-only fallback should guarantee. The job never
 * deletes an event, so events gone since it started were removed on purpose (`undo`, `clear`): noted, not a failure.
 */
export function verifyProjectDimensions(db: MigrationDatabase, mark: GatherMark | null): JobVerification {
  const checked = countRows(db, 'SELECT COUNT(*) AS count FROM events')
  const unresolved = countRows(
    db,
    'SELECT COUNT(*) AS count FROM events WHERE repo_name IS NOT NULL AND project_id IS NULL'
  )
  const unlinkedSaves = countRows(
    db,
    'SELECT COUNT(*) AS count FROM events WHERE file_path IS NOT NULL AND id NOT IN (SELECT event_id FROM event_file)'
  )
  const keptEvents = countRows(db, 'SELECT COUNT(*) AS count FROM events WHERE id <= ?', mark?.throughId ?? 0)
  const removedEvents = (mark?.events ?? 0) - keptEvents
  const notes = methodNotes(db)
  if (unlinkedSaves > 0) {
    notes.push(`${unlinkedSaves} saved file${unlinkedSaves === 1 ? ' is' : 's are'} in no repo git could find`)
  }
  if (removedEvents > 0) notes.push(`${eventCount(removedEvents)} removed while the upgrade ran (undo or clear)`)
  return {
    checked,
    resolved: checked - unresolved,
    unresolved,
    hasPassed: unresolved === 0,
    notes,
  }
}
