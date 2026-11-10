// What `context --file --json` says about the file itself — for a tooltip about the file rather than the whole
// session. Pure: the session's events, the commits and how to display a path are passed in.
import path from 'path'
import type { EventRow } from '../db/types'
import type { GitCommit } from './git-commits'
import { parseMetadata } from './event-metadata'
import { agentNameOf } from '../ai/engines/template/agents'
import { addKnown, knownCount, sumKnown } from '../ai/engines/template/changes'
import type { AgentSessionInfo } from '../db/agent-sessions'

// How many of the session's other files to name; the rest are only counted
const EDITED_ALONGSIDE_LIMIT = 5
const CODE_EDIT = 'code_edit'

export interface FileDetails {
  path: string
  relativePath: string
  firstSavedAt: string
  lastSavedAt: string
  /** Saves recorded — repeated saves of a file from one source within 30 s are one save, not every keystroke save */
  saveCount: number
  branch: string | null
  commits: GitCommit[]
  editedAlongside: { files: string[]; total: number }
  /** Of those saves, the ones made in the editor and the ones a coding agent made */
  editorSaves: number
  agentEdits: number
  /** The sum of the known line counts of all its edits; null when none had counts */
  linesAdded: number | null
  linesRemoved: number | null
  /** Who changed it, one entry per source (`vscode`, `claude-code`) */
  changedBy: FileChangedBy[]
  /** The agent conversations that edited it. A recap appears only while `capture.agentMessages` is on. */
  agentSessions: FileAgentSession[]
}

export interface FileChangedBy {
  source: string | null
  /** The agent's name ("Claude Code"); null for the editor */
  agent: string | null
  count: number
  linesAdded: number | null
  linesRemoved: number | null
}

export interface FileAgentSession {
  source: string
  agent: string | null
  startedAt: string
  endedAt: string | null
  recap: string | null
}

/** A file relative to its repo root when it's inside it, else its name. Pass resolved paths on both sides. */
export function displayPath(absoluteFilePath: string, repoRoot: string | null): string {
  if (repoRoot) {
    const relative = path.relative(repoRoot, absoluteFilePath)
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative
  }
  return path.basename(absoluteFilePath)
}

/** When an edit event last changed its file: a merged event's latest edit, else when it was captured. */
function lastEditTimeOf(event: EventRow): string {
  const { lastEditAt } = parseMetadata(event.metadata)
  return typeof lastEditAt === 'string' ? lastEditAt : event.captured_at
}

/** Whether a stored path is the file being asked about — the same path, or (when the caller can tell) the same file. */
export type FileMatcher = (storedPath: string) => boolean

function samePathAs(filePath: string): FileMatcher {
  return (storedPath) => storedPath === filePath
}

/** The session's other saved files, most-saved first, then most recently saved. */
function otherFilesBySaves(sessionEvents: EventRow[], isThisFile: FileMatcher): string[] {
  const saves = new Map<string, { count: number; lastSavedAt: string }>()
  for (const event of sessionEvents) {
    if (event.category !== CODE_EDIT || !event.file_path || isThisFile(event.file_path)) continue
    const seen = saves.get(event.file_path)
    const editedAt = lastEditTimeOf(event)
    saves.set(event.file_path, {
      count: (seen?.count ?? 0) + 1,
      lastSavedAt: seen && seen.lastSavedAt > editedAt ? seen.lastSavedAt : editedAt,
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
  /** Which stored paths are this file; by default only `filePath` itself */
  isThisFile?: FileMatcher
  /** The thread's agent conversations; those that edited this file are told, with a recap only if `showRecaps` */
  agentSessions?: AgentSessionInfo[]
  showRecaps?: boolean
}

/** Who made the saves, with the line counts they added up to. */
function changedByOf(saves: EventRow[]): FileChangedBy[] {
  const bySource = new Map<string | null, FileChangedBy>()
  for (const save of saves) {
    const { linesAdded, linesRemoved } = parseMetadata(save.metadata)
    const seen = bySource.get(save.source) ?? {
      source: save.source,
      agent: agentNameOf(save.source ?? undefined),
      count: 0,
      linesAdded: null,
      linesRemoved: null,
    }
    bySource.set(save.source, {
      ...seen,
      count: seen.count + 1,
      linesAdded: addKnown(seen.linesAdded, knownCount(linesAdded)),
      linesRemoved: addKnown(seen.linesRemoved, knownCount(linesRemoved)),
    })
  }
  return [...bySource.values()]
}

/** The agent conversations behind these saves, oldest first. */
function agentSessionsOf(saves: EventRow[], sessions: AgentSessionInfo[], showRecaps: boolean): FileAgentSession[] {
  const ids = new Set(saves.flatMap((save) => save.agent_session_id ?? []))
  return sessions
    .filter((session) => ids.has(session.id))
    .map((session) => ({
      source: session.source,
      agent: agentNameOf(session.source),
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      recap: showRecaps ? session.recap : null,
    }))
}

/** The session's saves of this file, oldest first. */
export function savesOf(sessionEvents: EventRow[], isThisFile: FileMatcher): EventRow[] {
  return sessionEvents.filter(
    (event) => event.category === CODE_EDIT && event.file_path !== null && isThisFile(event.file_path)
  )
}

/** The file's saves in the session, or null if it has none (it was found through a non-save event). */
export function buildFileDetails(options: FileDetailsOptions): FileDetails | null {
  const { filePath, sessionEvents, displayPathOf } = options
  const isThisFile = options.isThisFile ?? samePathAs(filePath)
  const saves = savesOf(sessionEvents, isThisFile)
  if (saves.length === 0) return null

  const savedTimes = saves.map((save) => save.captured_at).sort()
  const editedTimes = saves.map(lastEditTimeOf).sort()
  // Saves are oldest first, so the last one with a branch is the latest
  const latestBranch = [...saves].reverse().find((save) => save.branch)?.branch ?? null
  const otherFiles = otherFilesBySaves(sessionEvents, isThisFile)
  const changedBy = changedByOf(saves)
  const agentEdits = changedBy.filter((who) => who.agent !== null).reduce((total, who) => total + who.count, 0)

  return {
    path: filePath,
    relativePath: displayPathOf(filePath),
    firstSavedAt: savedTimes[0],
    lastSavedAt: editedTimes.at(-1) ?? savedTimes[0],
    saveCount: saves.length,
    branch: latestBranch ?? options.sessionBranch,
    commits: options.commits,
    editedAlongside: {
      files: otherFiles.slice(0, EDITED_ALONGSIDE_LIMIT).map(displayPathOf),
      total: otherFiles.length,
    },
    editorSaves: saves.length - agentEdits,
    agentEdits,
    linesAdded: sumKnown(changedBy.map((who) => who.linesAdded)),
    linesRemoved: sumKnown(changedBy.map((who) => who.linesRemoved)),
    changedBy,
    agentSessions: agentSessionsOf(saves, options.agentSessions ?? [], options.showRecaps === true),
  }
}
