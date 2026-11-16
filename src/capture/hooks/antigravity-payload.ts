// What Workscribe reads from Antigravity's PostToolUse hook payload, checked against `agy` 1.5.0
// (tests/fixtures/agent-hooks/antigravity/1.5.0/). Pure. `lastUserInput`, file text (`Content`, `Target`,
// `Replacement`) and everything else not named here are never read into the result.
import { optionalLineCount, type EditCounts } from '../edit-counts'
import type { HookEvent, Outcome } from './event'
import { asRecord, parsePayloadRecord, stringOf, type Payload } from './payload'

/** The tool that runs a shell command. */
export const COMMAND_TOOL = 'run_command'
const REPLACE_TOOL = 'edit_file'
const WRITE_TOOL = 'write_file'
/** The tools that change a file. */
const EDIT_TOOLS: readonly string[] = [REPLACE_TOOL, WRITE_TOOL]
/** Every tool Workscribe's hook is installed for: `read_file` and the rest also fire `PostToolUse` and are left out. */
export const WATCHED_TOOLS: readonly string[] = [COMMAND_TOOL, ...EDIT_TOOLS]

/** What every tool event shares: where the agent works, its conversation, and whether the tool call itself failed. */
interface ToolContext {
  cwd: string
  sessionId: string | null
  failed: boolean
}

/** `edit_file` replaces `Target` with `Replacement`, in one call. */
function replacementCounts(args: Payload): EditCounts {
  return { linesAdded: optionalLineCount(args.Replacement), linesRemoved: optionalLineCount(args.Target) }
}

/** `write_file`: a new file's lines are all added (it sends no `Overwrite`); an overwrite doesn't say what it replaced. */
function writeCounts(args: Payload): EditCounts {
  return { linesAdded: optionalLineCount(args.Content), linesRemoved: args.Overwrite === true ? null : 0 }
}

function commandEvent(args: Payload, context: ToolContext): HookEvent | null {
  const command = stringOf(args.CommandLine)
  if (!command) return null
  // `error` stays empty for a command that exited non-zero: only a tool call that failed itself fills it
  const outcome: Outcome = context.failed ? { kind: 'failed' } : { kind: 'unknown' }
  return { kind: 'command', command, cwd: context.cwd, outcome, durationMs: null, sessionId: context.sessionId }
}

function editEvent(tool: string, args: Payload, context: ToolContext): HookEvent | null {
  // A failed edit changed nothing
  const file = stringOf(args.Path)
  if (!file || context.failed) return null
  const counts = tool === WRITE_TOOL ? writeCounts(args) : replacementCounts(args)
  return { kind: 'edit', file, cwd: context.cwd, ...counts, sessionId: context.sessionId }
}

function workspaceOf(payload: Payload): string | null {
  return Array.isArray(payload.workspacePaths) ? stringOf(payload.workspacePaths[0]) : null
}

/**
 * An Antigravity hook payload, by the event it was installed for. Null for what Workscribe doesn't store: every event
 * but `PostToolUse`, tools other than the three watched, and a payload with no command, file or workspace folder.
 */
export function parseAntigravityHook(raw: string, event: string): HookEvent | null {
  if (event !== 'PostToolUse') return null
  const payload = parsePayloadRecord(raw)
  const call = asRecord(payload?.toolCall)
  const args = asRecord(call?.args)
  const cwd = payload ? workspaceOf(payload) : null
  if (!payload || !call || !args || !cwd) return null

  const context: ToolContext = {
    cwd,
    sessionId: stringOf(payload.conversationId),
    failed: stringOf(payload.error) !== null,
  }
  if (call.name === COMMAND_TOOL) return commandEvent(args, context)
  if (typeof call.name === 'string' && EDIT_TOOLS.includes(call.name)) {
    return editEvent(call.name, args, context)
  }
  return null
}
