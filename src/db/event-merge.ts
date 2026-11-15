// One action, one event (WOR-160): an action two capture paths both saw is stored once, with the agent's source,
// whichever arrived first. Called inside the insert's transaction, so two captures at once can't both insert.
// `node:sqlite`-free, so tests run it on an in-memory database. The rules (what counts as the same action, how long
// apart) are `src/capture/merge-rules.ts`.
import type { MigrationDatabase } from './migration-types'
import type { NewEvent } from './event-writer'
import { upsertAgentSession } from './agent-sessions'
import { normalizeForFilter } from '../capture/filter'
import { mergedEditMetadata, type EditCounts } from '../capture/edit-counts'
import { parseMetadata } from '../summary/event-metadata'
import {
  AGENT_MERGE_WINDOW_MS,
  COMMAND_MERGE_WINDOW_MS,
  IMPORTED_HOOK_SOURCE,
  SAVE_MERGE_WINDOW_MS,
  isImportedHookPair,
  isInsideFolder,
  isSameCommand,
  isWithin,
  mergedExitCode,
} from '../capture/merge-rules'

const CODE_EDIT = 'code_edit'
// Rows looked at around an event's time; a few seconds of capture are never more than a handful of commands
const CANDIDATE_LIMIT = 50

interface StoredEvent {
  id: number
  capturedAt: string
  command: string
  cwd: string
  exitCode: number | null
  durationMs: number | null
  category: string
  metadata: string | null
  source: string | null
  agentSessionId: number | null
}

const STORED_COLUMNS = `id, captured_at AS capturedAt, command, cwd, exit_code AS exitCode, duration_ms AS durationMs,
  category, metadata, source, agent_session_id AS agentSessionId`

/** The commands stored around the event's time, newest first. Edits and saves are other rows' business. */
function recentCommands(db: MigrationDatabase, event: NewEvent): StoredEvent[] {
  const time = Date.parse(event.captured_at)
  return db
    .prepare(
      `SELECT ${STORED_COLUMNS} FROM events
       WHERE captured_at BETWEEN ? AND ? AND category <> '${CODE_EDIT}'
       ORDER BY id DESC LIMIT ${CANDIDATE_LIMIT}`
    )
    .all(
      new Date(time - COMMAND_MERGE_WINDOW_MS).toISOString(),
      new Date(time + COMMAND_MERGE_WINDOW_MS).toISOString()
    ) as unknown as StoredEvent[]
}

/** The file's latest event of any kind, as `mergeIntoRecentEdit` reads it. */
function latestEventOfFile(db: MigrationDatabase, event: NewEvent): StoredEvent | undefined {
  return db
    .prepare(`SELECT ${STORED_COLUMNS} FROM events WHERE file_path = ? AND cwd = ? ORDER BY id DESC LIMIT 1`)
    .get(event.file_path, event.cwd) as StoredEvent | undefined
}

/** When an edit last changed the file: a repeated edit moves `lastEditAt`, the event's own time stays. */
function editTimeOf(row: StoredEvent): string {
  const { lastEditAt } = parseMetadata(row.metadata)
  return typeof lastEditAt === 'string' ? lastEditAt : row.capturedAt
}

function isRelatedFolder(first: string, second: string): boolean {
  return isInsideFolder(first, second) || isInsideFolder(second, first)
}

/**
 * The surviving row, told who did it: the agent's source and conversation, and what it lacked — a real exit code, a
 * duration. It never clears a field, and keeps its own time, folder and links (the first row's win).
 */
function adopt(
  db: MigrationDatabase,
  survivor: StoredEvent,
  event: NewEvent,
  changes: { command?: string; metadata?: string | null } = {}
): void {
  const agentSessionId = event.agentSession
    ? upsertAgentSession(db, { ...event.agentSession, cwd: event.cwd, capturedAt: event.captured_at })
    : survivor.agentSessionId
  db.prepare(
    `UPDATE events SET source = ?, agent_session_id = ?, exit_code = ?, duration_ms = ?, command = ?, metadata = ?
     WHERE id = ?`
  ).run(
    event.source,
    agentSessionId,
    mergedExitCode(survivor.exitCode, event.exit_code),
    survivor.durationMs ?? event.duration_ms,
    changes.command ?? survivor.command,
    changes.metadata === undefined ? survivor.metadata : changes.metadata,
    survivor.id
  )
}

/** A person's shell row for what an agent already stored: the row gains the shell's real exit code and duration. */
function mergeShellCommand(db: MigrationDatabase, event: NewEvent, agentSources: string[]): boolean {
  // Only a person's shell row: a command with a source of its own (an editor's task, another tool) is its own event
  if (event.source !== null) return false
  const survivor = recentCommands(db, event).find(
    (row) =>
      row.source !== null &&
      agentSources.includes(row.source) &&
      isSameCommand(row.command, event.command) &&
      isInsideFolder(event.cwd, row.cwd)
  )
  if (!survivor) return false
  db.prepare('UPDATE events SET exit_code = ?, duration_ms = ? WHERE id = ?').run(
    mergedExitCode(survivor.exitCode, event.exit_code),
    survivor.durationMs ?? event.duration_ms,
    survivor.id
  )
  return true
}

/**
 * The same action from the imported hook and an agent of its own (Cursor runs `~/.claude/settings.json` too): the
 * imported event is dropped, or, when it came first, the agent's event takes its row over. True when handled.
 */
function mergeImportedHook(
  db: MigrationDatabase,
  event: NewEvent,
  survivor: StoredEvent | undefined,
  agentSources: string[],
  changes: { command?: string } = {}
): boolean {
  if (!survivor || !isImportedHookPair(event.source, survivor.source, agentSources)) return false
  if (event.source === IMPORTED_HOOK_SOURCE) return true
  adopt(db, survivor, event, changes)
  return true
}

/** An agent's command for what the shell hook already stored, or for the imported hook's copy of it. */
function mergeAgentCommand(
  db: MigrationDatabase,
  event: NewEvent,
  { sharesShell, agentSources }: { sharesShell: boolean; agentSources: string[] }
): boolean {
  const rows = recentCommands(db, event).filter((row) => isSameCommand(row.command, event.command))
  const shellRow = rows.find(
    (row) => sharesShell && row.source === null && row.agentSessionId === null && isInsideFolder(row.cwd, event.cwd)
  )
  if (shellRow) {
    adopt(db, shellRow, event, { command: normalizeForFilter(event.command) })
    return true
  }
  const otherAgentRow = rows.find(
    (row) =>
      isImportedHookPair(event.source, row.source, agentSources) &&
      isRelatedFolder(row.cwd, event.cwd) &&
      isWithin(row.capturedAt, event.captured_at, AGENT_MERGE_WINDOW_MS)
  )
  return mergeImportedHook(db, event, otherAgentRow, agentSources, { command: normalizeForFilter(event.command) })
}

function knownCounts(metadata: string | null): boolean {
  return typeof parseMetadata(metadata).linesAdded === 'number'
}

function countsOf(metadata: string | null): EditCounts {
  const { linesAdded, linesRemoved } = parseMetadata(metadata)
  return {
    linesAdded: typeof linesAdded === 'number' ? linesAdded : null,
    linesRemoved: typeof linesRemoved === 'number' ? linesRemoved : null,
  }
}

/** An agent's edit for the save it caused (stored first) or for the imported hook's copy of the same edit. */
function mergeAgentEdit(
  db: MigrationDatabase,
  event: NewEvent,
  { sharesSaves, agentSources }: { sharesSaves: boolean; agentSources: string[] }
): boolean {
  const latest = latestEventOfFile(db, event)
  if (!latest || latest.category !== CODE_EDIT) return false
  const isSaveOfThisEdit =
    sharesSaves &&
    latest.source !== null &&
    !agentSources.includes(latest.source) &&
    latest.agentSessionId === null &&
    isWithin(latest.capturedAt, event.captured_at, SAVE_MERGE_WINDOW_MS)
  if (isSaveOfThisEdit) {
    // The save has no line counts of its own to lose; the edit's become the event's, and `lastEditAt` its time
    const metadata = knownCounts(latest.metadata)
      ? latest.metadata
      : mergedEditMetadata(latest.metadata, countsOf(event.metadata), event.captured_at)
    adopt(db, latest, event, { metadata })
    return true
  }
  const isRecent = isWithin(editTimeOf(latest), event.captured_at, AGENT_MERGE_WINDOW_MS)
  return isRecent && mergeImportedHook(db, event, latest, agentSources)
}

/** An editor's save that the agent's own write caused: it is part of the agent's edit, which already counts it. */
function mergeEditorSave(db: MigrationDatabase, event: NewEvent, agentSources: string[]): boolean {
  const latest = latestEventOfFile(db, event)
  return (
    latest !== undefined &&
    latest.category === CODE_EDIT &&
    latest.agentSessionId !== null &&
    latest.source !== null &&
    agentSources.includes(latest.source) &&
    isWithin(editTimeOf(latest), event.captured_at, SAVE_MERGE_WINDOW_MS)
  )
}

/**
 * Merges the event into a row already stored for the same action, if its merge rule finds one. True when the event
 * is accounted for — merged into that row, or dropped as the imported hook's copy — and so must not be inserted.
 */
export function mergeIntoRecentEvent(db: MigrationDatabase, event: NewEvent): boolean {
  const { merge } = event
  if (!merge) return false
  switch (merge.kind) {
    case 'shell-command':
      return mergeShellCommand(db, event, merge.agentSources)
    case 'agent-command':
      return mergeAgentCommand(db, event, merge)
    case 'agent-edit':
      return mergeAgentEdit(db, event, merge)
    case 'editor-save':
      return mergeEditorSave(db, event, merge.agentSources)
  }
}
