// What Workscribe reads from Claude Code's edit and session hook payloads, checked against Claude Code 2.1.319
// (tests/fixtures/agent-hooks/claude-code/2.1.319/). Pure. File contents, old and new text, patches and the agent's
// words are read here only to count lines or to hand on to the opt-in recap path — the edit result never holds text.
import type { EditCounts } from '../edit-counts'

/** The edit tools the hook matches. 2.1.319 has no MultiEdit, so its shape isn't pinned by a fixture. */
export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'] as const

/** The session events Workscribe hooks, besides tool events and UserPromptSubmit. */
export const SESSION_EVENTS = ['Stop', 'PostCompact', 'SessionEnd'] as const
export type SessionEvent = (typeof SESSION_EVENTS)[number]
/** The session events that carry the agent's own words: a turn's last reply, and the compaction summary. */
export type MessageEvent = Exclude<SessionEvent, 'SessionEnd'>

const UNKNOWN_COUNTS: EditCounts = { linesAdded: null, linesRemoved: null }

export interface AgentEdit extends EditCounts {
  file: string
  cwd: string
  /** The agent conversation the edit was made in. Null if not sent */
  sessionId: string | null
}

export interface AgentSessionEvent {
  sessionId: string
  /** Stop's last reply or PostCompact's summary: free text, for the opt-in recap only */
  message: string | null
  /** Why SessionEnd fired (`other`, `clear`, `logout`, …) */
  reason: string | null
}

type Payload = Record<string, unknown>

function asRecord(value: unknown): Payload | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Payload) : null
}

/** A hook's stdin as an object, or null when it's empty or not an object. Invalid JSON throws, as `_hook` expects. */
function parsePayloadRecord(raw: string): Payload | null {
  return raw.trim() ? asRecord(JSON.parse(raw)) : null
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}

/** Lines in a text: a trailing newline ends the last line rather than starting another. */
function lineCount(text: string): number {
  if (text === '') return 0
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length
}

function optionalLineCount(value: unknown): number | null {
  return typeof value === 'string' ? lineCount(value) : null
}

/** Counts from Claude Code's unified-diff hunks (`structuredPatch`), or null when there's no patch to read. */
function patchCounts(response: Payload | null): EditCounts | null {
  const hunks = response?.structuredPatch
  if (!Array.isArray(hunks) || hunks.length === 0) return null
  const lines = hunks.flatMap((hunk) => {
    const hunkLines = asRecord(hunk)?.lines
    return Array.isArray(hunkLines) ? hunkLines.filter((line): line is string => typeof line === 'string') : []
  })
  return {
    linesAdded: lines.filter((line) => line.startsWith('+')).length,
    linesRemoved: lines.filter((line) => line.startsWith('-')).length,
  }
}

/**
 * Edit and MultiEdit without a patch: the strings, unless a replace-all hides how many places changed. No edits at all
 * means the payload didn't say, not that nothing changed.
 */
function replacementCounts(edits: Payload[]): EditCounts {
  if (edits.length === 0 || edits.some((edit) => edit.replace_all === true)) return UNKNOWN_COUNTS
  return edits.reduce<EditCounts>(
    (total, edit) => ({
      linesAdded: addKnown(total.linesAdded, optionalLineCount(edit.new_string)),
      linesRemoved: addKnown(total.linesRemoved, optionalLineCount(edit.old_string)),
    }),
    { linesAdded: 0, linesRemoved: 0 }
  )
}

function addKnown(total: number | null, count: number | null): number | null {
  return total === null || count === null ? null : total + count
}

/** Write: a new file's lines are all added; an overwrite with no patch doesn't say what it replaced. */
function writeCounts(input: Payload, response: Payload | null): EditCounts {
  const linesAdded = optionalLineCount(input.content)
  return { linesAdded, linesRemoved: response?.type === 'create' ? 0 : null }
}

/** NotebookEdit: the cell's old and new source, which the response carries. */
function notebookCounts(response: Payload | null): EditCounts {
  const mode = response?.edit_mode
  return {
    linesAdded: mode === 'delete' ? 0 : optionalLineCount(response?.new_source),
    linesRemoved: mode === 'insert' ? 0 : optionalLineCount(response?.old_source),
  }
}

function countsOf(tool: string, input: Payload, response: Payload | null): EditCounts {
  if (tool === 'NotebookEdit') return notebookCounts(response)
  const fromPatch = patchCounts(response)
  if (fromPatch) return fromPatch
  if (tool === 'Write') return writeCounts(input, response)
  if (tool === 'MultiEdit') return replacementCounts((Array.isArray(input.edits) ? input.edits : []).map(editOf))
  return replacementCounts([input])
}

/** One of a MultiEdit's edits; one that isn't an object has no strings to count. */
function editOf(value: unknown): Payload {
  return asRecord(value) ?? {}
}

function isEditTool(tool: unknown): tool is string {
  return (EDIT_TOOLS as readonly unknown[]).includes(tool)
}

function sessionIdOf(payload: Payload): string | null {
  return stringOf(payload.session_id)
}

/** A PostToolUse payload for an edit tool: the file, where the agent was, and its line counts. Null for the rest. */
export function parseEditPayload(raw: string): AgentEdit | null {
  const payload = parsePayloadRecord(raw)
  if (!payload || !isEditTool(payload.tool_name)) return null
  const input = asRecord(payload.tool_input)
  const file = stringOf(input?.file_path) ?? stringOf(input?.notebook_path)
  const cwd = stringOf(payload.cwd)
  if (!input || !file || !cwd) return null
  const counts = countsOf(payload.tool_name, input, asRecord(payload.tool_response))
  return { file, cwd, ...counts, sessionId: sessionIdOf(payload) }
}

export function isSessionEvent(event: string): event is SessionEvent {
  return (SESSION_EVENTS as readonly string[]).includes(event)
}

/** A Stop, PostCompact or SessionEnd payload. Null without a session id: there's no session to record it on. */
export function parseSessionEventPayload(raw: string, event: SessionEvent): AgentSessionEvent | null {
  const payload = parsePayloadRecord(raw)
  const sessionId = payload ? sessionIdOf(payload) : null
  if (!payload || !sessionId) return null
  const messageField = event === 'Stop' ? payload.last_assistant_message : payload.compact_summary
  return {
    sessionId,
    message: event === 'SessionEnd' ? null : stringOf(messageField),
    reason: event === 'SessionEnd' ? stringOf(payload.reason) : null,
  }
}
