import path from 'path'
import type { MigrationDatabase } from '../migration-types'
import type { DirectoryProbe } from '../../capture/git'
import { projectIdentity, type ProjectIdentity } from '../../capture/project-identity'
import { withImmediateTransaction, withReadTransaction } from '../transaction'
import { FILE_SAVE_ACTION, linkEventFile, upsertBranch, upsertFile, upsertProject } from '../dimensions'
import { relativeInside } from '../../utils/working-directory'
import { deleteMetaValue, getMetaValue, setMetaValue } from './store'
import { foldersToProbe, loadProbes, saveProbe } from './directory-probes'
import {
  FALLBACK_METHODS,
  resolvePairs,
  type ObservedPair,
  type PairResolution,
  type ResolutionMethod,
} from './project-resolution'
import { fallbackIssues, fallbackReason, verifyProjectDimensions, type GatherMark } from './project-dimensions-report'
import type { BatchResult, DataJob, GatherOutcome, JobIssue } from './types'

// Links every stored event to its project, branch and file (migration 008), for the events captured before capture
// wrote the links itself. Git is asked once per folder, outside the write lock, and the answer is kept in
// `directory_probe`: a rerun after a version bump asks nothing and gives the same answer.

const GATHER_MARK_KEY = 'project-dimensions:gathered'

interface EventToLink {
  id: number
  cwd: string
  repo_name: string | null
  branch: string | null
  file_path: string | null
  project_id: number | null
}

/** A pair's project as stored in `project_resolution`. */
interface StoredResolution {
  projectId: number | null
  method: ResolutionMethod
}

function pairKey(cwd: string, repoName: string | null): string {
  return `${cwd}\u0000${repoName ?? ''}`
}

function readGatherMark(db: MigrationDatabase): GatherMark | null {
  const value = getMetaValue(db, GATHER_MARK_KEY)
  return value === null ? null : (JSON.parse(value) as GatherMark)
}

function storeResolution(db: MigrationDatabase, resolution: PairResolution, eventCount: number): StoredResolution {
  const projectId = resolution.project === null ? null : upsertProject(db, resolution.project)
  db.prepare(
    `INSERT OR REPLACE INTO project_resolution (cwd, repo_name, project_id, method, event_count)
     VALUES (?, ?, ?, ?, ?)`
  ).run(resolution.cwd, resolution.repoName ?? '', projectId, resolution.method, eventCount)
  return { projectId, method: resolution.method }
}

/**
 * Resolves every stored pair at once — the rules compare pairs with each other, so they need the whole set — and
 * marks how far the events went, so batches can tell events captured since (which capture linked itself).
 */
function resolveAllPairs(db: MigrationDatabase): void {
  const { counted, mark } = withReadTransaction(db, () => ({
    counted: db.prepare('SELECT cwd, repo_name, COUNT(*) AS events FROM events GROUP BY cwd, repo_name').all() as {
      cwd: string
      repo_name: string | null
      events: number
    }[],
    mark: db.prepare('SELECT COALESCE(MAX(id), 0) AS throughId, COUNT(*) AS events FROM events').get() as GatherMark,
  }))
  const resolutions = resolvePairs(
    counted.map((row) => ({ cwd: row.cwd, repoName: row.repo_name })),
    loadProbes(db)
  )
  withImmediateTransaction(db, () => {
    resolutions.forEach((resolution, index) => storeResolution(db, resolution, counted[index].events))
    setMetaValue(db, GATHER_MARK_KEY, JSON.stringify(mark))
  })
}

function storedPairs(db: MigrationDatabase): ObservedPair[] {
  const rows = db.prepare('SELECT cwd, repo_name FROM project_resolution').all() as { cwd: string; repo_name: string }[]
  return rows.map((row) => ({ cwd: row.cwd, repoName: row.repo_name === '' ? null : row.repo_name }))
}

/**
 * A pair first seen after gathering, on an event capture couldn't link. Resolved with the same rules over the folders
 * already probed; a folder never probed counts as unknown, so only the name rules can place it. Batches never call git.
 */
function resolveLatePair(db: MigrationDatabase, pair: ObservedPair, issues: JobIssue[]): StoredResolution {
  const resolutions = resolvePairs([...storedPairs(db), pair], loadProbes(db))
  const resolution = resolutions[resolutions.length - 1]
  const stored = storeResolution(db, resolution, 1)
  if (FALLBACK_METHODS.includes(resolution.method)) {
    const reason = fallbackReason(resolution.method, 1, resolution.project?.identity ?? null)
    issues.push({
      reference: `${pair.cwd} (${pair.repoName ?? ''})`,
      reason: `captured while the upgrade ran; ${reason}`,
    })
  }
  return stored
}

function storedResolution(db: MigrationDatabase, cwd: string, repoName: string | null): StoredResolution | null {
  const row = db
    .prepare('SELECT project_id, method FROM project_resolution WHERE cwd = ? AND repo_name = ?')
    .get(cwd, repoName ?? '') as { project_id: number | null; method: ResolutionMethod } | undefined
  return row === undefined ? null : { projectId: row.project_id, method: row.method }
}

/** Where a saved file sits — its repo and its path in it — from what git said about its folder. Null: in no repo. */
function locateFile(
  filePath: string,
  probes: Map<string, DirectoryProbe>
): { identity: ProjectIdentity; root: string; relativePath: string } | null {
  const probe = probes.get(path.dirname(filePath))
  if (probe?.outcome !== 'repo') return null
  const identity = projectIdentity(probe)
  const relativePath = relativeInside(probe.root, filePath)
  if (identity === null || !relativePath) return null
  return { identity, root: probe.root, relativePath }
}

function placeFile(
  db: MigrationDatabase,
  filePath: string,
  probes: Map<string, DirectoryProbe>
): { projectId: number; relativePath: string } | null {
  const location = locateFile(filePath, probes)
  if (location === null) return null
  const projectId = upsertProject(db, { ...location.identity, name: null, root: location.root })
  return { projectId, relativePath: location.relativePath }
}

/** One issue per folder whose saves the job can't place, with how many there are. */
function unplacedSaveIssues(
  db: MigrationDatabase,
  probes: Map<string, DirectoryProbe>,
  mark: GatherMark | null
): JobIssue[] {
  const saves = db
    .prepare('SELECT file_path FROM events WHERE file_path IS NOT NULL AND id <= ?')
    .all(mark?.throughId ?? 0) as { file_path: string }[]
  const unplacedByFolder = new Map<string, number>()
  for (const save of saves) {
    if (locateFile(save.file_path, probes) !== null) continue
    const folder = path.dirname(save.file_path)
    unplacedByFolder.set(folder, (unplacedByFolder.get(folder) ?? 0) + 1)
  }
  return [...unplacedByFolder.entries()]
    .sort(([first], [second]) => first.localeCompare(second))
    .map(([folder, count]) => ({
      reference: folder,
      reason: `${count} saved file${count === 1 ? '' : 's'} here, in no repo git could find`,
    }))
}

interface BatchContext {
  mark: GatherMark | null
  probes: Map<string, DirectoryProbe>
  resolutions: Map<string, StoredResolution>
  issues: JobIssue[]
}

function resolutionFor(db: MigrationDatabase, event: EventToLink, context: BatchContext): StoredResolution {
  const key = pairKey(event.cwd, event.repo_name)
  const cached = context.resolutions.get(key)
  if (cached !== undefined) return cached
  const pair = { cwd: event.cwd, repoName: event.repo_name }
  const resolution = storedResolution(db, event.cwd, event.repo_name) ?? resolveLatePair(db, pair, context.issues)
  context.resolutions.set(key, resolution)
  return resolution
}

/** Captured after the job resolved every pair, and already linked by capture: capture's links are the answer. */
function isLinkedByCapture(event: EventToLink, mark: GatherMark | null): boolean {
  return event.project_id !== null && event.id > (mark?.throughId ?? 0)
}

/** Links one event. A save takes the project of its file's repo; the branch is kept only for the folder's own repo. */
function linkEvent(db: MigrationDatabase, event: EventToLink, context: BatchContext): void {
  if (isLinkedByCapture(event, context.mark)) return
  const resolution = resolutionFor(db, event, context)
  const file = event.file_path === null ? null : placeFile(db, event.file_path, context.probes)
  const projectId = file?.projectId ?? resolution.projectId
  const isFoldersProject = projectId !== null && projectId === resolution.projectId
  const branchId = event.branch !== null && isFoldersProject ? upsertBranch(db, projectId, event.branch) : null
  db.prepare('UPDATE events SET project_id = ?, branch_id = ? WHERE id = ?').run(projectId, branchId, event.id)
  // A save that can't be placed is recorded once per folder, by the first batch
  if (file === null) return
  const fileId = upsertFile(db, file.projectId, file.relativePath)
  linkEventFile(db, { eventId: event.id, fileId, action: FILE_SAVE_ACTION })
}

/**
 * After the last batch: projects no event links to any more go, and each project takes the name of its newest event
 * stored under one of its own names — never a `git -C` event's name for another repo.
 */
function finishProjects(db: MigrationDatabase): void {
  db.exec(`
    DELETE FROM project
    WHERE id NOT IN (SELECT project_id FROM events WHERE project_id IS NOT NULL)
      AND id NOT IN (SELECT project_id FROM project_resolution WHERE project_id IS NOT NULL);
    UPDATE project SET name = COALESCE(
      (SELECT repo_name FROM events
       WHERE project_id = project.id
         AND repo_name IN (SELECT name FROM project_alias WHERE project_alias.project_id = project.id)
       ORDER BY id DESC LIMIT 1),
      name
    );
  `)
}

function runBatch(db: MigrationDatabase, afterId: number, limit: number): BatchResult {
  const events = db
    .prepare('SELECT id, cwd, repo_name, branch, file_path, project_id FROM events WHERE id > ? ORDER BY id LIMIT ?')
    .all(afterId, limit) as EventToLink[]
  if (events.length === 0) {
    finishProjects(db)
    return { lastId: null, issues: [] }
  }
  const mark = readGatherMark(db)
  const probes = loadProbes(db)
  const issues = afterId === 0 ? [...fallbackIssues(db), ...unplacedSaveIssues(db, probes, mark)] : []
  const context: BatchContext = { mark, probes, resolutions: new Map(), issues }
  for (const event of events) linkEvent(db, event, context)
  return { lastId: events[events.length - 1].id, issues: context.issues }
}

export interface ProjectDimensionsOptions {
  probeDirectory: (directory: string) => DirectoryProbe
}

export function createProjectDimensionsJob(options: ProjectDimensionsOptions): DataJob {
  return {
    name: 'project-dimensions',
    version: 1,
    description: 'Link stored events to their project, branch and file',
    // Batches rewrite every link up to the gather mark, so only the work tables go; the probes stay, so a rerun never
    // asks git again
    prepare: (db) => {
      db.exec('DELETE FROM event_file; DELETE FROM project_resolution;')
      deleteMetaValue(db, GATHER_MARK_KEY)
    },
    gather: (db, { isOverBudget }): GatherOutcome => {
      for (const folder of foldersToProbe(db)) {
        if (isOverBudget()) return 'incomplete'
        saveProbe(db, folder, options.probeDirectory(folder))
      }
      if (readGatherMark(db) === null) resolveAllPairs(db)
      return 'complete'
    },
    runBatch,
    verify: (db) => verifyProjectDimensions(db, readGatherMark(db)),
  }
}
