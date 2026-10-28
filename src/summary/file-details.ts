// What `context --file --json` says about the file itself — for a tooltip about the file rather than the whole
// session. Pure: the session's events, the commits and how to display a path are passed in.
import path from 'path'
import type { EventRow } from '../db/types'
import type { GitCommit } from './git-commits'

// How many of the session's other files to name; the rest are only counted
const EDITED_ALONGSIDE_LIMIT = 5
const CODE_EDIT = 'code_edit'

export interface FileDetails {
  path: string
  relativePath: string
  firstSavedAt: string
  lastSavedAt: string
  /** Saves recorded — capture keeps one save per file per 30 s, so not every keystroke save */
  saveCount: number
  branch: string | null
  commits: GitCommit[]
  editedAlongside: { files: string[]; total: number }
}

/** A file relative to its repo root when it's inside it, else its name. Pass resolved paths on both sides. */
export function displayPath(absoluteFilePath: string, repoRoot: string | null): string {
  if (repoRoot) {
    const relative = path.relative(repoRoot, absoluteFilePath)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative
  }
  return path.basename(absoluteFilePath)
}

/** The session's other saved files, most-saved first, then most recently saved. */
function otherFilesBySaves(sessionEvents: EventRow[], filePath: string): string[] {
  const saves = new Map<string, { count: number; lastSavedAt: string }>()
  for (const event of sessionEvents) {
    if (event.category !== CODE_EDIT || !event.file_path || event.file_path === filePath) continue
    const seen = saves.get(event.file_path)
    saves.set(event.file_path, {
      count: (seen?.count ?? 0) + 1,
      lastSavedAt: seen && seen.lastSavedAt > event.captured_at ? seen.lastSavedAt : event.captured_at,
    })
  }
  return [...saves.entries()]
    .sort(([, first], [, second]) => second.count - first.count || second.lastSavedAt.localeCompare(first.lastSavedAt))
    .map(([otherPath]) => otherPath)
}

export interface FileDetailsOptions {
  filePath: string
  sessionEvents: EventRow[]
  sessionBranch: string | null
  commits: GitCommit[]
  /** How to show a stored path — relative to the repo root, resolving symlinks (see `displayPath`) */
  displayPathOf: (storedPath: string) => string
}

/** The session's saves of this file, oldest first. */
export function savesOf(sessionEvents: EventRow[], filePath: string): EventRow[] {
  return sessionEvents.filter((event) => event.category === CODE_EDIT && event.file_path === filePath)
}

/** The file's saves in the session, or null if it has none (it was found through a non-save event). */
export function buildFileDetails(options: FileDetailsOptions): FileDetails | null {
  const { filePath, sessionEvents, displayPathOf } = options
  const saves = savesOf(sessionEvents, filePath)
  if (saves.length === 0) return null

  const savedTimes = saves.map((save) => save.captured_at).sort()
  // Saves are oldest first, so the last one with a branch is the latest
  const latestBranch = [...saves].reverse().find((save) => save.branch)?.branch ?? null
  const otherFiles = otherFilesBySaves(sessionEvents, filePath)

  return {
    path: filePath,
    relativePath: displayPathOf(filePath),
    firstSavedAt: savedTimes[0],
    lastSavedAt: savedTimes.at(-1) ?? savedTimes[0],
    saveCount: saves.length,
    branch: latestBranch ?? options.sessionBranch,
    commits: options.commits,
    editedAlongside: {
      files: otherFiles.slice(0, EDITED_ALONGSIDE_LIMIT).map(displayPathOf),
      total: otherFiles.length,
    },
  }
}
