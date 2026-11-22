import fs from 'fs'
import { insertEvent, getLastEvent, mergeRecentEdit, getLastEventForCwd } from '../db'
import { editMetadata, type EditCounts } from './edit-counts'
import { redact } from './redact'
import { commandHint } from './hint'
import { getRepoContext } from './git'
import { getCommitsSince, latestCommitSubject } from './git-snapshot'
import { exitCodeAfterCommitCheck } from './commit-check'
import { readLastAiderPrompt } from './aider'
import { normalizeCommand } from '../normalize/patterns'
import { readConfig } from '../config'
import { shouldFilter, isDuplicate } from './filter'
import { canMergeAcrossSources } from './merge-rules'
import { isExcluded } from './excluded-paths'
import { mergeRuleOf } from './event-merge-rule'
import type { HookOverlaps } from './hooks/types'
import { boundedCommand } from './command-steps'
import { IDE_DEDUP_WINDOW_MS, TASK_RUN_DEDUP_WINDOW_MS } from './ide'
import { PAUSE_FLAG_PATH } from '../utils/paths'
import { loadAIToolRegistry } from '../config/registry'
import { effectiveDirectory } from '../normalize/git-directory'
import { readCommitMessageFile } from './commit-message-file'
import { eventDimensions, fileEventDimensions } from './dimensions'
import type { AgentSessionRef } from '../db/agent-sessions'
import type { EventDimensions } from '../db/dimensions'
import type { TicketKeys } from '../db/tickets'
import type { WorkscribeConfig } from '../config'
import { ticketKeysOf, ticketPatternOf } from './tickets'
import type { CommitSource } from '../summary/commits'

/**
 * The ticket keys an event names, with the branch it's linked to — none when it isn't linked to one. A config.json
 * edited to drop `tickets` means the default pattern, never a failed capture.
 */
function ticketsOf(event: CommitSource, dimensions: EventDimensions, config: WorkscribeConfig): TicketKeys {
  return ticketKeysOf({ linkedBranch: dimensions.branch, event }, ticketPatternOf(config.tickets?.pattern))
}

/**
 * `git commit -F <file>`: the message, read now while the file may still exist and redacted like the command — and
 * never the path, which isn't stored.
 */
function withMessageFromFile(
  metadata: Record<string, unknown>,
  workDirectory: string,
  extraRedactions: string[]
): Record<string, unknown> {
  const { messageFile, ...rest } = metadata
  if (typeof messageFile !== 'string') return metadata
  const message = readCommitMessageFile(messageFile, workDirectory)
  return { ...rest, message: message ? redact(message, extraRedactions) : null }
}

/** `HEAD`'s subject for a commit check, redacted like the stored message it's compared with. */
function redactedHeadSubject(category: string, workDirectory: string, extraRedactions: string[]): string | null {
  if (category !== 'shipping') return null
  const subject = latestCommitSubject(workDirectory)
  return subject === null ? null : redact(subject, extraRedactions)
}

export function captureCommand(opts: {
  command?: string
  cwd: string
  exitCode: number | null
  durationMs: number | null
  gitBefore?: string
  source?: string
  type?: string
  file?: string
  /** A `code_edit`'s line counts; missing means unknown */
  linesAdded?: number | null
  linesRemoved?: number | null
  /** The agent conversation a hook event came from — a command or an edit; editor and shell events have none */
  agentSession?: AgentSessionRef
  /** The source's hooks report no failure for commands: a commit with no exit code is checked against `HEAD` */
  verifyCommit?: boolean
  /** Given by every agent hook event (empty when it overlaps with nothing): what else records the same action */
  overlaps?: HookOverlaps
}): void {
  // Check pause flag before any I/O
  if (fs.existsSync(PAUSE_FLAG_PATH)) return

  const config = readConfig()
  const { cwd, exitCode, durationMs } = opts

  // An excluded folder is never recorded: dropped like a pause, before anything is looked up or stored
  if (isExcluded({ cwd, file: opts.file, command: opts.command }, config.capture.excludePaths)) return

  // ─── IDE event path ──────────────────────────────────────────────────────────
  // When --type is provided, the caller has already classified the event.
  // Skip normalization and noise filtering — these are first-party signals.
  if (opts.type) {
    const isEdit = opts.type === 'code_edit'
    const counts: EditCounts = { linesAdded: opts.linesAdded ?? null, linesRemoved: opts.linesRemoved ?? null }
    const capturedAt = new Date().toISOString()

    // Repeated edits of a file from the same source and agent session within 30 s add their line counts to the first
    // one, so a burst of auto-saves or agent edits is one event that still adds up to the real change
    const repeatableEdit =
      isEdit && opts.file
        ? {
            filePath: opts.file,
            cwd,
            source: opts.source ?? null,
            agentSession: opts.agentSession,
            counts,
            editedAt: capturedAt,
            windowMs: IDE_DEDUP_WINDOW_MS,
          }
        : null
    if (repeatableEdit && mergeRecentEdit(repeatableEdit)) return

    // A shell task running in a hooked terminal already got captured with a
    // real category by the shell hook — skip the generic duplicate.
    if (opts.type === 'task_run') {
      const lastForCwd = getLastEventForCwd(cwd)
      if (lastForCwd && !lastForCwd.source) {
        const lastTime = new Date(lastForCwd.captured_at).getTime()
        if (Date.now() - lastTime < TASK_RUN_DEDUP_WINDOW_MS) return
      }
    }

    const command =
      opts.command === undefined ? (opts.file ?? opts.type) : boundedCommand(redact(opts.command, config.redact.extra))
    const context = getRepoContext(cwd, config)
    const { repoName, branch } = context
    const ideEvent = {
      captured_at: capturedAt,
      command,
      cwd,
      exit_code: exitCode,
      duration_ms: durationMs,
      repo_name: repoName,
      branch,
      category: opts.type,
      metadata: isEdit ? editMetadata(counts) : null,
      source: opts.source ?? null,
      file_path: opts.file ?? null,
    }
    const dimensions = opts.file ? fileEventDimensions(context, opts.file, config) : eventDimensions(context)
    // Only a hook passes an agent session, so an agent's edit belongs to its conversation and an editor save to none
    insertEvent({
      ...ideEvent,
      dimensions,
      tickets: ticketsOf(ideEvent, dimensions, config),
      agentSession: opts.agentSession,
      merge: mergeRuleOf(opts),
    })
    return
  }

  // ─── Shell event path ─────────────────────────────────────────────────────────
  const command = opts.command as string

  // 1. Filter noise commands
  if (shouldFilter(command, config.capture.ignore)) return

  // 2. Redact sensitive patterns — before the duplicate check, which compares what is stored
  const safeCommand = redact(command, config.redact.extra)
  const storedCommand = boundedCommand(safeCommand)

  // 3. Deduplicate: same command + same cwd within 5 seconds
  // A row from a source this one merges with isn't a duplicate to drop: the merge below gives it this event's source
  const merge = mergeRuleOf(opts)
  const last = getLastEvent()
  const isMergeable = merge !== undefined && canMergeAcrossSources(merge, opts.source ?? null, last?.source ?? null)
  if (!isMergeable && isDuplicate(storedCommand, cwd, last ?? undefined)) return

  // 4. Normalize to typed event — first, because the repo depends on which step did the work
  const { category, metadata: normalizedMetadata, matchedStep } = normalizeCommand(safeCommand)

  if (category === 'ai_session' && config.capture.aiTools === false) return

  // 5. Extract git context from where the work happened — `git -C ../web commit` belongs to web, not here — named
  // exactly as the IDE path, notes and `context` name it
  const workDirectory = effectiveDirectory({ matchedStep: matchedStep ?? safeCommand, cwd })
  // `git -C <excluded> …` run from elsewhere worked in the excluded folder
  if (workDirectory !== cwd && isExcluded({ cwd: workDirectory }, config.capture.excludePaths)) return
  const context = getRepoContext(workDirectory, config)
  const { repoName, branch } = context
  const metadata = withMessageFromFile(normalizedMetadata, workDirectory, config.redact.extra)

  // Hint passthrough: preserve context for unrecognised commands so the AI can describe them
  if (category === 'other') {
    const firstToken = safeCommand.trim().split(/\s+/)[0]
    if (firstToken) metadata.tool = firstToken
    metadata.hint = commandHint(storedCommand)
  }

  // 6. For ai_session events, enrich metadata
  if (category === 'ai_session') {
    // 6a. Commits made during the session
    if (opts.gitBefore) {
      const commits = getCommitsSince(opts.gitBefore, workDirectory)
      if (commits.length > 0) metadata.commits = commits.map((subject) => redact(subject, config.redact.extra))
    }

    // 6b. Last user prompt from history file (e.g. Aider)
    if (config.capture.includeAiderPrompt !== false) {
      const toolEntry = loadAIToolRegistry().find((entry) => entry.tool === metadata.tool)
      if (toolEntry?.contextSource === 'history-file') {
        const prompt = readLastAiderPrompt(cwd, config.redact.extra)
        if (prompt) metadata.prompt = prompt
      }
    }
  }

  // 7. Persist — a commit a source can't report on is checked against HEAD, after the command has run
  const storedExitCode = opts.verifyCommit
    ? exitCodeAfterCommitCheck({
        exitCode,
        category,
        metadata,
        headSubject: redactedHeadSubject(category, workDirectory, config.redact.extra),
      })
    : exitCode
  const shellEvent = {
    captured_at: new Date().toISOString(),
    command: storedCommand,
    cwd,
    exit_code: storedExitCode,
    duration_ms: durationMs,
    repo_name: repoName,
    branch,
    category,
    metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
    source: opts.source ?? null,
    file_path: null,
  }
  const dimensions = eventDimensions(context)
  insertEvent({
    ...shellEvent,
    dimensions,
    tickets: ticketsOf(shellEvent, dimensions, config),
    agentSession: opts.agentSession,
    merge,
  })
}
