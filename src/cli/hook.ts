import { Command } from 'commander'
import { captureCommand } from '../capture'
import { readConfig } from '../config'
import { debugLog } from '../utils/logger'
import { containsSecrets } from '../capture/detect-secrets'
import { insertAlert } from '../db/alerts'

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

export function registerHook(program: Command): void {
  // Internal command — called by AI tool hooks (e.g. Claude Code PostToolUse), not by the user
  program
    .command('_hook')
    .description('Internal: capture events from AI tool hooks (stdin JSON payload)')
    .option('--source <source>', 'hook source identifier (e.g. claude-code)')
    .option('--event <event>', 'hook event type (PostToolUse, PostToolUseFailure or UserPromptSubmit)', 'PostToolUse')
    .action((opts: { source?: string; event: string }) => {
      let raw = ''
      process.stdin.setEncoding('utf-8')
      process.stdin.on('data', (chunk: string) => {
        raw += chunk
      })
      process.stdin.on('end', () => {
        try {
          if (opts.event === 'UserPromptSubmit') {
            const parsed = parseUserPromptPayload(raw)
            if (!parsed) return
            if (containsSecrets(parsed.prompt)) {
              insertAlert(
                opts.source ?? 'unknown',
                parsed.session_id || null,
                'Possible credential detected in prompt submitted to AI tool'
              )
              // Claude Code reads this JSON and injects systemMessage into Claude's context
              process.stdout.write(
                JSON.stringify({
                  systemMessage:
                    'Workscribe detected a possible credential in your prompt. ' +
                    'Run `workscribe alerts` for details.',
                })
              )
            }
            return
          }

          // A finished Bash command, successful or not — anything else is an event this version doesn't handle
          if (!isToolEvent(opts.event)) return
          if (readConfig().capture.aiTools === false) return
          const parsed = parseHookPayload(raw, opts.event)
          if (!parsed) return
          const { sessionId, ...command } = parsed
          // Only with a source, so the event and its session always name the same agent
          const agentSession = sessionId && opts.source ? { source: opts.source, sessionId } : undefined
          captureCommand({ ...command, source: opts.source, agentSession })
        } catch (err) {
          debugLog('_hook', err)
        }
      })
    })
}
