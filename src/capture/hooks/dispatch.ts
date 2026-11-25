// What `_hook` does with a payload, whichever agent sent it: find the agent's integration by `--source`, have it read
// the payload into the shared shape, and store that. Every agent gets the same pause, `capture.aiTools`,
// `capture.agentEdits`, credential-alert and recap rules here, so an integration only has to parse.
import fs from 'fs'
import { captureCommand } from '..'
import { readConfig } from '../../config'
import { debugLog } from '../../utils/logger'
import { PAUSE_FLAG_PATH } from '../../utils/paths'
import { containsSecrets } from '../detect-secrets'
import { storableAgentMessage, storableEndReason, storableIntent } from '../agent-messages'
import { insertAlert } from '../../db/alerts'
import { recordAgentSessionEnding, recordAgentSessionMessage } from '../../db'
import type { AgentSessionRef } from '../../db/agent-sessions'
import { exitCodeOf, type HookEvent } from './event'
import { AI_HOOK_INTEGRATIONS } from './index'
import type { AIHookIntegration } from './types'

type Of<Kind extends HookEvent['kind']> = Extract<HookEvent, { kind: Kind }>

// Hooks installed before `--source` existed pass none; they were Claude Code's
const LEGACY_SOURCE = 'claude-code'
// What an alert says its source was when a prompt arrives with none
const NO_SOURCE = 'unknown'

/** The conversation an event came from — only with a source, so the event and its session name the same agent. */
function agentSessionOf(sessionId: string | null, source: string | undefined): AgentSessionRef | undefined {
  return sessionId && source ? { source, sessionId } : undefined
}

function handlePrompt(event: Of<'prompt'>, source: string | undefined): void {
  if (!containsSecrets(event.text)) return
  insertAlert(source ?? NO_SOURCE, event.sessionId, 'Possible credential detected in prompt submitted to AI tool')
  // Claude Code reads this JSON and injects systemMessage into Claude's context
  process.stdout.write(
    JSON.stringify({
      systemMessage: 'Workscribe detected a possible credential in your prompt. Run `workscribe alerts` for details.',
    })
  )
}

function handleEdit(event: Of<'edit'>, source: string | undefined, integration: AIHookIntegration): void {
  if (readConfig().capture.agentEdits === false) return
  // A file the agent changed: its path and line counts, never the text, as an edit of its conversation
  captureCommand({
    cwd: event.cwd,
    exitCode: null,
    durationMs: null,
    type: 'code_edit',
    file: event.file,
    source,
    linesAdded: event.linesAdded,
    linesRemoved: event.linesRemoved,
    agentSession: agentSessionOf(event.sessionId, source),
    overlaps: integration.overlaps ?? {},
  })
}

/**
 * What the agent said the command is for, as it may be stored: only with `capture.agentMessages` on (it is the agent's
 * own words, like a recap), redacted and cut. Null stores nothing. A command that later merges into an earlier row
 * (`event-merge.ts`, only when an agent sets `overlaps`, which none does yet) leaves the survivor's metadata, so its
 * intent is lost there.
 */
function storableIntentOf(event: Of<'command'>): string | null {
  if (!event.intent) return null
  const config = readConfig()
  return config.capture.agentMessages === true ? storableIntent(event.intent, config.redact.extra) : null
}

function handleCommand(event: Of<'command'>, source: string | undefined, integration: AIHookIntegration): void {
  const intent = storableIntentOf(event)
  captureCommand({
    command: event.command,
    cwd: event.cwd,
    exitCode: exitCodeOf(event.outcome),
    durationMs: event.durationMs,
    source,
    agentSession: agentSessionOf(event.sessionId, source),
    overlaps: integration.overlaps ?? {},
    ...(integration.checksCommits ? { verifyCommit: true } : {}),
    ...(intent === null ? {} : { intent }),
  })
}

function handleMessage(event: Of<'message'>, session: AgentSessionRef): void {
  const config = readConfig()
  if (config.capture.agentMessages !== true || event.text === null) return
  const text = storableAgentMessage(event.text, config.redact.extra)
  if (text === null) return
  recordAgentSessionMessage({ ...session, kind: event.messageKind, text })
}

/**
 * How a session ended, and the agent's recap. These write the session directly rather than through captureCommand,
 * so they check the pause flag and `capture.aiTools` themselves.
 */
function handleSessionEvent(event: Of<'session-end'> | Of<'message'>, source: string | undefined): void {
  if (fs.existsSync(PAUSE_FLAG_PATH)) return
  const session = agentSessionOf(event.sessionId, source)
  if (!session) return
  if (event.kind === 'message') {
    handleMessage(event, session)
    return
  }
  recordAgentSessionEnding({
    ...session,
    endedAt: new Date().toISOString(),
    reason: storableEndReason(event.reason),
  })
}

function store(event: HookEvent, source: string | undefined, integration: AIHookIntegration): void {
  if (event.kind === 'prompt') return handlePrompt(event, source)
  if (readConfig().capture.aiTools === false) return
  if (event.kind === 'command') return handleCommand(event, source, integration)
  if (event.kind === 'edit') return handleEdit(event, source, integration)
  handleSessionEvent(event, source)
}

/**
 * Reads and stores one hook payload. Never throws: an unknown source, invalid JSON, or a payload missing what it
 * needs is dropped, and only `WORKSCRIBE_DEBUG` says why.
 */
export function dispatchHook(raw: string, hookEvent: string, source: string | undefined): void {
  try {
    const integration = AI_HOOK_INTEGRATIONS[source ?? LEGACY_SOURCE]
    if (!integration) return
    const event = integration.parse(raw, hookEvent)
    if (event) store(event, source, integration)
  } catch (error) {
    debugLog('_hook', error)
  }
}
