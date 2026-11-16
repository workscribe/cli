// What Workscribe reads from Claude Code's edit and session hook payloads, checked against Claude Code 2.1.319
// (tests/fixtures/agent-hooks/claude-code/2.1.319/). Pure. File contents, old and new text, patches and the agent's
// words are read here only to count lines or to hand on to the opt-in recap path — the edit result never holds text.
import { optionalLineCount, type EditCounts } from '../edit-counts'
import { asRecord, parsePayloadRecord, stringOf, type Payload } from './payload'
import type { AgentMessageKind } from '../../db/agent-sessions'
import type { HookEvent, Outcome } from './event'

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

/** The Claude Code events that report a finished Bash command — the success and the failure halves. */
export const TOOL_EVENTS = ['PostToolUse', 'PostToolUseFailure'] as const
export type ToolEvent = (typeof TOOL_EVENTS)[number]

export function isToolEvent(event: string): event is ToolEvent {
  return (TOOL_EVENTS as readonly string[]).includes(event)
}

export interface HookCommand {
  command: string
  cwd: string
  /** 0 for a success, the real code for a failure, null when it's unknown (an interrupted call) */
  exitCode: number | null
  durationMs: number | null
  /** The agent conversation the command ran in — the same across every folder it worked in. Null if not sent */
  sessionId: string | null
}

// PostToolUseFailure's `error` starts with this for a Bash command that ran and exited
const EXIT_CODE_LINE = /^Exit code (\d+)/

/**
 * The exit code an event implies. Claude Code fires PostToolUse only when a Bash call succeeds and
 * PostToolUseFailure only when it fails (checked against Claude Code 2.1.311 — see
 * tests/fixtures/claude-code-hooks/). Only the first line of `error` is read; its output never is.
 */
function exitCodeOfToolEvent(event: ToolEvent, payload: Payload): number | null {
  if (event === 'PostToolUse') return 0
  if (payload.is_interrupt === true || typeof payload.error !== 'string') return null
  const exitCode = payload.error.match(EXIT_CODE_LINE)?.[1]
  return exitCode === undefined ? null : Number(exitCode)
}

/** Parses a Claude Code PostToolUse or PostToolUseFailure stdin payload. Returns null if required fields are missing. */
export function parseHookPayload(raw: string, event: ToolEvent = 'PostToolUse'): HookCommand | null {
  if (!raw.trim()) return null
  const payload = JSON.parse(raw) as Payload
  // The hook's matcher is `Bash`, but settings can be edited: exit codes only mean something for shell commands
  if (payload.tool_name !== undefined && payload.tool_name !== 'Bash') return null
  const toolInput = payload.tool_input as Payload | undefined
  const command = typeof toolInput?.command === 'string' ? toolInput.command : null
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : null
  if (!command || !cwd) return null
  const durationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : null
  const sessionId = typeof payload.session_id === 'string' && payload.session_id !== '' ? payload.session_id : null
  return { command, cwd, exitCode: exitCodeOfToolEvent(event, payload), durationMs, sessionId }
}

interface UserPromptPayload {
  session_id: string
  prompt: string
  cwd: string
}

/** Parses a Claude Code UserPromptSubmit stdin payload. Returns null if required fields are missing. */
export function parseUserPromptPayload(raw: string): UserPromptPayload | null {
  if (!raw.trim()) return null
  const payload = JSON.parse(raw) as Payload
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : null
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : ''
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : ''
  if (!prompt) return null
  return { session_id: sessionId, prompt, cwd }
}

const MESSAGE_KINDS: Record<MessageEvent, AgentMessageKind> = { Stop: 'recap', PostCompact: 'compactSummary' }

function outcomeOfExitCode(exitCode: number | null): Outcome {
  return exitCode === null ? { kind: 'unknown' } : { kind: 'exit', code: exitCode }
}

function parseToolEvent(raw: string, event: ToolEvent): HookEvent | null {
  // A failure is always a Bash command: the failure hook matches nothing else, and a failed edit changed nothing
  const edit = event === 'PostToolUse' ? parseEditPayload(raw) : null
  if (edit) {
    const { file, cwd, linesAdded, linesRemoved, sessionId } = edit
    return { kind: 'edit', file, cwd, linesAdded, linesRemoved, sessionId }
  }
  const command = parseHookPayload(raw, event)
  if (!command) return null
  const { exitCode, ...rest } = command
  return { kind: 'command', ...rest, outcome: outcomeOfExitCode(exitCode) }
}

function parseSessionEvent(raw: string, event: SessionEvent): HookEvent | null {
  const parsed = parseSessionEventPayload(raw, event)
  if (!parsed) return null
  if (event === 'SessionEnd') return { kind: 'session-end', sessionId: parsed.sessionId, reason: parsed.reason }
  return { kind: 'message', sessionId: parsed.sessionId, messageKind: MESSAGE_KINDS[event], text: parsed.message }
}

/** Any Claude Code hook payload, by the event the hook was installed for. Null for what Workscribe doesn't store. */
export function parseClaudeHook(raw: string, event: string): HookEvent | null {
  if (event === 'UserPromptSubmit') {
    const prompt = parseUserPromptPayload(raw)
    return prompt ? { kind: 'prompt', text: prompt.prompt, sessionId: prompt.session_id || null } : null
  }
  if (isToolEvent(event)) return parseToolEvent(raw, event)
  if (isSessionEvent(event)) return parseSessionEvent(raw, event)
  // Anything else is an event this version doesn't handle
  return null
}
