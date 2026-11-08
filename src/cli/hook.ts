import fs from 'fs'
import { Command } from 'commander'
import { captureCommand } from '../capture'
import { readConfig } from '../config'
import { debugLog } from '../utils/logger'
import { PAUSE_FLAG_PATH } from '../utils/paths'
import { containsSecrets } from '../capture/detect-secrets'
import { storableAgentMessage, storableEndReason } from '../capture/agent-messages'
import {
  isSessionEvent,
  parseEditPayload,
  parseSessionEventPayload,
  type AgentEdit,
  type MessageEvent,
  type SessionEvent,
} from '../capture/hooks/claude-code-payload'
import { insertAlert } from '../db/alerts'
import { recordAgentSessionEnding, recordAgentSessionMessage } from '../db'
import type { AgentMessageKind, AgentSessionRef } from '../db/agent-sessions'

/** The Claude Code events that report a finished Bash command — the success and the failure halves. */
export const TOOL_EVENTS = ['PostToolUse', 'PostToolUseFailure'] as const
export type ToolEvent = (typeof TOOL_EVENTS)[number]

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
function exitCodeOf(event: ToolEvent, payload: Record<string, unknown>): number | null {
  if (event === 'PostToolUse') return 0
  if (payload.is_interrupt === true || typeof payload.error !== 'string') return null
  const exitCode = payload.error.match(EXIT_CODE_LINE)?.[1]
  return exitCode === undefined ? null : Number(exitCode)
}

/** Parses a Claude Code PostToolUse or PostToolUseFailure stdin payload. Returns null if required fields are missing. */
export function parseHookPayload(raw: string, event: ToolEvent = 'PostToolUse'): HookCommand | null {
  if (!raw.trim()) return null
  const payload = JSON.parse(raw) as Record<string, unknown>
  // The hook's matcher is `Bash`, but settings can be edited: exit codes only mean something for shell commands
  if (payload.tool_name !== undefined && payload.tool_name !== 'Bash') return null
  const toolInput = payload.tool_input as Record<string, unknown> | undefined
  const command = typeof toolInput?.command === 'string' ? toolInput.command : null
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : null
  if (!command || !cwd) return null
  const durationMs = typeof payload.duration_ms === 'number' ? payload.duration_ms : null
  const sessionId = typeof payload.session_id === 'string' && payload.session_id !== '' ? payload.session_id : null
  return { command, cwd, exitCode: exitCodeOf(event, payload), durationMs, sessionId }
}

function isToolEvent(event: string): event is ToolEvent {
  return (TOOL_EVENTS as readonly string[]).includes(event)
}

interface UserPromptPayload {
  session_id: string
  prompt: string
  cwd: string
}

/** Parses a Claude Code UserPromptSubmit stdin payload. Returns null if required fields are missing. */
export function parseUserPromptPayload(raw: string): UserPromptPayload | null {
  if (!raw.trim()) return null
  const payload = JSON.parse(raw) as Record<string, unknown>
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : null
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : ''
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : ''
  if (!prompt) return null
  return { session_id: sessionId, prompt, cwd }
}

/** The conversation an event came from — only with a source, so the event and its session name the same agent. */
function agentSessionOf(sessionId: string | null, source: string | undefined): AgentSessionRef | undefined {
  return sessionId && source ? { source, sessionId } : undefined
}

function handleUserPrompt(raw: string, source: string | undefined): void {
  const parsed = parseUserPromptPayload(raw)
  if (!parsed || !containsSecrets(parsed.prompt)) return
  insertAlert(
    source ?? 'unknown',
    parsed.session_id || null,
    'Possible credential detected in prompt submitted to AI tool'
  )
  // Claude Code reads this JSON and injects systemMessage into Claude's context
  process.stdout.write(
    JSON.stringify({
      systemMessage: 'Workscribe detected a possible credential in your prompt. Run `workscribe alerts` for details.',
    })
  )
}

/** A file the agent changed: its path and line counts, never the text, as an edit of its conversation. */
function captureAgentEdit(edit: AgentEdit, source: string | undefined): void {
  captureCommand({
    cwd: edit.cwd,
    exitCode: null,
    durationMs: null,
    type: 'code_edit',
    file: edit.file,
    source,
    linesAdded: edit.linesAdded,
    linesRemoved: edit.linesRemoved,
    agentSession: agentSessionOf(edit.sessionId, source),
  })
}

/** A finished tool call: an edit, or a Bash command, successful or not. A failed edit changed nothing. */
function handleToolEvent(raw: string, event: ToolEvent, source: string | undefined): void {
  const config = readConfig()
  if (config.capture.aiTools === false) return
  // A failure is always a Bash command: the failure hook matches nothing else, and a failed edit changed nothing
  const edit = event === 'PostToolUse' ? parseEditPayload(raw) : null
  if (edit) {
    if (config.capture.agentEdits !== false) captureAgentEdit(edit, source)
    return
  }
  const parsed = parseHookPayload(raw, event)
  if (!parsed) return
  const { sessionId, ...command } = parsed
  captureCommand({ ...command, source, agentSession: agentSessionOf(sessionId, source) })
}

const MESSAGE_KINDS: Record<MessageEvent, AgentMessageKind> = { Stop: 'recap', PostCompact: 'compactSummary' }

/** Stop and PostCompact: the agent's own words, kept only when `capture.agentMessages` is on. */
function recordMessage(session: AgentSessionRef, event: MessageEvent, message: string | null): void {
  const config = readConfig()
  if (config.capture.agentMessages !== true || message === null) return
  const text = storableAgentMessage(message, config.redact.extra)
  if (text === null) return
  recordAgentSessionMessage({ ...session, kind: MESSAGE_KINDS[event], text })
}

/**
 * How a session ended, and the agent's recap. These write the session directly rather than through captureCommand,
 * so they check the pause flag and `capture.aiTools` themselves.
 */
function handleSessionEvent(raw: string, event: SessionEvent, source: string | undefined): void {
  if (fs.existsSync(PAUSE_FLAG_PATH) || readConfig().capture.aiTools === false) return
  const parsed = parseSessionEventPayload(raw, event)
  const session = parsed ? agentSessionOf(parsed.sessionId, source) : undefined
  if (!parsed || !session) return
  if (event === 'SessionEnd') {
    recordAgentSessionEnding({
      ...session,
      endedAt: new Date().toISOString(),
      reason: storableEndReason(parsed.reason),
    })
    return
  }
  recordMessage(session, event, parsed.message)
}

function handleHookEvent(raw: string, event: string, source: string | undefined): void {
  if (event === 'UserPromptSubmit') handleUserPrompt(raw, source)
  else if (isToolEvent(event)) handleToolEvent(raw, event, source)
  else if (isSessionEvent(event)) handleSessionEvent(raw, event, source)
  // Anything else is an event this version doesn't handle
}

export function registerHook(program: Command): void {
  // Internal command — called by AI tool hooks (e.g. Claude Code PostToolUse), not by the user
  program
    .command('_hook')
    .description('Internal: capture events from AI tool hooks (stdin JSON payload)')
    .option('--source <source>', 'hook source identifier (e.g. claude-code)')
    .option(
      '--event <event>',
      'hook event type (PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop, PostCompact or SessionEnd)',
      'PostToolUse'
    )
    .action((opts: { source?: string; event: string }) => {
      let raw = ''
      process.stdin.setEncoding('utf-8')
      process.stdin.on('data', (chunk: string) => {
        raw += chunk
      })
      process.stdin.on('end', () => {
        try {
          handleHookEvent(raw, opts.event, opts.source)
        } catch (err) {
          debugLog('_hook', err)
        }
      })
    })
}
