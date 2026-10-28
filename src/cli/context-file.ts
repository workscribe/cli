// The I/O behind `context --file`: grouping the day the file was last saved, and the file details for --json.
import { getEventsBySessionId, getLatestFileSaveAt, getSessionBranch } from '../db'
import type { SessionRow } from '../db/types'
import { isDatabaseLocked } from '../db/transaction'
import { ensureDayGrouped } from '../sessions/detector'
import { buildFileDetails, displayPath, savesOf, type FileDetails } from '../summary/file-details'
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

/** What the session says about this file: its saves, branch, commits and the files edited alongside it. */
export function getFileDetails(filePath: string, session: SessionRow): FileDetails | null {
  const sessionEvents = getEventsBySessionId(session.id)
  // Found through a non-save event: nothing to say about the file, so don't spend the git budget
  if (savesOf(sessionEvents, filePath).length === 0) return null

  // git reports the resolved repo root, and the editor may have opened the file through a symlink
  const { repoRoot, commits } = getFileCommits({
    filePath: resolvedPath(filePath),
    since: session.started_at,
    until: session.ended_at,
    budgetMs: GIT_BUDGET_MS,
  })
  return buildFileDetails({
    filePath,
    sessionEvents,
    sessionBranch: getSessionBranch(session.id),
    commits,
    displayPathOf: (storedPath) => displayPath(resolvedPath(storedPath), repoRoot),
  })
}
