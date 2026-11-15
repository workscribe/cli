// The one shape every agent's hook payload is parsed into, so the handler that stores it knows nothing about any
// agent's payload. Pure.
import type { AgentMessageKind } from '../../db/agent-sessions'

/**
 * How a command ended. `failed` is for a tool that says the command failed without giving a code — Cursor, Gemini CLI,
 * Antigravity and Copilot don't document exit codes. `unknown` is everything else: no signal at all, or an interrupt.
 */
export type Outcome = { kind: 'exit'; code: number } | { kind: 'failed' } | { kind: 'unknown' }

/** Stored for a command that failed with no code known. Null stays "unknown"; `isFailedExit` reads this as a failure. */
export const FAILED_EXIT_CODE = -1

export function exitCodeOf(outcome: Outcome): number | null {
  if (outcome.kind === 'exit') return outcome.code
  return outcome.kind === 'failed' ? FAILED_EXIT_CODE : null
}

export type HookEvent =
  | {
      kind: 'command'
      command: string
      cwd: string
      outcome: Outcome
      durationMs: number | null
      /** The agent conversation the command ran in. Null if not sent */
      sessionId: string | null
    }
  | {
      kind: 'edit'
      file: string
      cwd: string
      linesAdded: number | null
      linesRemoved: number | null
      sessionId: string | null
    }
  | { kind: 'prompt'; text: string; sessionId: string | null }
  | { kind: 'session-end'; sessionId: string; reason: string | null }
  /** The agent's own words: a turn's last reply, or a compaction summary. Kept only with `capture.agentMessages` */
  | { kind: 'message'; sessionId: string; messageKind: AgentMessageKind; text: string | null }
