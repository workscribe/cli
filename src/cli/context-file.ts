// The I/O behind `context --file`: grouping the day the file was last saved, and the file details for --json.
import { getLatestFileSaveAt } from '../db'
import type { EventRow } from '../db/types'
import { isDatabaseLocked } from '../db/transaction'
import { ensureDayGrouped } from '../sessions/detector'
import { buildFileDetails, displayPath, savesOf, type FileDetails, type FileMatcher } from '../summary/file-details'
import { getFileCommits } from '../summary/git-commits'
import { localDateOf } from '../utils/format'
import { resolvedPath } from '../utils/working-directory'

// The VS Code extension gives up on `context --file` after 5 s and then shows nothing, so the whole command has to
// answer well within that: about 1 s waiting for another process's lock, at most 2 s of git
export const LOCK_WAIT_MS = 1000
export const GIT_BUDGET_MS = 2000

/**
 * Groups the day this file was last saved, if that day isn't up to date — so today's work shows without running
 * `summary` first. If another process holds the lock past LOCK_WAIT_MS, the answer comes from the sessions as they
 * are; the next call catches up.
 */
export function groupDayOfLatestSave(filePath: string): void {
  const latestSave = getLatestFileSaveAt(filePath)
  if (!latestSave) return
  try {
    ensureDayGrouped(localDateOf(latestSave), { lockWaitMs: LOCK_WAIT_MS })
  } catch (error) {
    if (!isDatabaseLocked(error)) throw error
  }
}

/** The stretch of work `context --file` answers with: an old session or a thread, as its events and span. */
export interface FileSpan {
  events: EventRow[]
  branch: string | null
  startedAt: string
  endedAt: string
}

/** What the span says about this file: its saves, branch, commits and the files edited alongside it. */
/** The stored path is this file: the same path, or another path to the same file on disk (through a symlink). */
function sameFileAs(filePath: string): FileMatcher {
  const fileOnDisk = resolvedPath(filePath)
  return (storedPath) => storedPath === filePath || resolvedPath(storedPath) === fileOnDisk
}

export function getFileDetails(filePath: string, span: FileSpan): FileDetails | null {
  const isThisFile = sameFileAs(filePath)
  // Found through a non-save event: nothing to say about the file, so don't spend the git budget
  if (savesOf(span.events, isThisFile).length === 0) return null

  // git reports the resolved repo root, and the editor may have opened the file through a symlink
  const { repoRoot, commits } = getFileCommits({
    filePath: resolvedPath(filePath),
    since: span.startedAt,
    until: span.endedAt,
    budgetMs: GIT_BUDGET_MS,
  })
  return buildFileDetails({
    filePath,
    sessionEvents: span.events,
    sessionBranch: span.branch,
    commits,
    isThisFile,
    displayPathOf: (storedPath) => displayPath(resolvedPath(storedPath), repoRoot),
  })
}
