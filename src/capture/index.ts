import fs from 'fs'
import { insertEvent, getLastEvent, getLastEventForFile, getLastEventForCwd } from '../db'
import { redact } from './redact'
import { getRepoContext } from './git'
import { getCommitsSince } from './git-snapshot'
import { readLastAiderPrompt } from './aider'
import { normalizeCommand } from '../normalize/patterns'
import { readConfig } from '../config'
import { shouldFilter, isDuplicate } from './filter'
import { IDE_DEDUP_WINDOW_MS, TASK_RUN_DEDUP_WINDOW_MS } from './ide'
import { PAUSE_FLAG_PATH } from '../utils/paths'
import { loadAIToolRegistry } from '../config/registry'
import { effectiveDirectory } from '../normalize/git-directory'
import { readCommitMessageFile } from './commit-message-file'

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

export function captureCommand(opts: {
  command?: string
  cwd: string
  exitCode: number | null
  durationMs: number | null
  gitBefore?: string
  source?: string
  type?: string
  file?: string
}): void {
  // Check pause flag before any I/O
  if (fs.existsSync(PAUSE_FLAG_PATH)) return

  const config = readConfig()
  const { cwd, exitCode, durationMs } = opts

  // ─── IDE event path ──────────────────────────────────────────────────────────
  // When --type is provided, the caller has already classified the event.
  // Skip normalization and noise filtering — these are first-party signals.
  if (opts.type) {
    // For file-save events, deduplicate per-file with a longer window (30s) to
    // absorb rapid auto-saves of the same file.
    if (opts.type === 'code_edit' && opts.file) {
      const lastForFile = getLastEventForFile(opts.file, cwd)
      if (lastForFile) {
        const lastTime = new Date(lastForFile.captured_at).getTime()
        if (Date.now() - lastTime < IDE_DEDUP_WINDOW_MS) return
      }
    }

    // A shell task running in a hooked terminal already got captured with a
    // real category by the shell hook — skip the generic duplicate.
    if (opts.type === 'task_run') {
      const lastForCwd = getLastEventForCwd(cwd)
      if (lastForCwd && !lastForCwd.source) {
        const lastTime = new Date(lastForCwd.captured_at).getTime()
        if (Date.now() - lastTime < TASK_RUN_DEDUP_WINDOW_MS) return
      }
    }

    const command = opts.command ?? opts.file ?? opts.type
    const { repoName, branch } = getRepoContext(cwd, config)

    insertEvent({
      captured_at: new Date().toISOString(),
      command,
      cwd,
      exit_code: exitCode,
      duration_ms: durationMs,
      repo_name: repoName,
      branch,
      category: opts.type,
      metadata: null,
      source: opts.source ?? null,
      file_path: opts.file ?? null,
    })
    return
  }

  // ─── Shell event path ─────────────────────────────────────────────────────────
  const command = opts.command as string

  // 1. Filter noise commands
  if (shouldFilter(command, config.capture.ignore)) return

  // 2. Deduplicate: same command + same cwd within 5 seconds
  const last = getLastEvent()
  if (isDuplicate(command, cwd, last ?? undefined)) return

  // 3. Redact sensitive patterns
  const safeCommand = redact(command, config.redact.extra)

  // 4. Normalize to typed event — first, because the repo depends on which step did the work
  const { category, metadata: normalizedMetadata, matchedStep } = normalizeCommand(safeCommand)

  if (category === 'ai_session' && config.capture.aiTools === false) return

  // 5. Extract git context from where the work happened — `git -C ../web commit` belongs to web, not here — named
  // exactly as the IDE path, notes and `context` name it
  const workDirectory = effectiveDirectory({ matchedStep: matchedStep ?? safeCommand, cwd })
  const { repoName, branch } = getRepoContext(workDirectory, config)
  const metadata = withMessageFromFile(normalizedMetadata, workDirectory, config.redact.extra)

  // Hint passthrough: preserve context for unrecognised commands so the AI can describe them
  if (category === 'other') {
    const firstToken = safeCommand.trim().split(/\s+/)[0]
    if (firstToken) metadata.tool = firstToken
    metadata.hint = safeCommand.trim().slice(0, 120)
  }

  // 6. For ai_session events, enrich metadata
  if (category === 'ai_session') {
    // 6a. Commits made during the session
    if (opts.gitBefore) {
      const commits = getCommitsSince(opts.gitBefore, workDirectory)
      if (commits.length > 0) metadata.commits = commits
    }

    // 6b. Last user prompt from history file (e.g. Aider)
    if (config.capture.includeAiderPrompt !== false) {
      const toolEntry = loadAIToolRegistry().find((entry) => entry.tool === metadata.tool)
      if (toolEntry?.contextSource === 'history-file') {
        const prompt = readLastAiderPrompt(cwd)
        if (prompt) metadata.prompt = prompt
      }
    }
  }

  // 7. Persist
  insertEvent({
    captured_at: new Date().toISOString(),
    command: safeCommand,
    cwd,
    exit_code: exitCode,
    duration_ms: durationMs,
    repo_name: repoName,
    branch,
    category,
    metadata: Object.keys(metadata).length > 0 ? JSON.stringify(metadata) : null,
    source: opts.source ?? null,
    file_path: null,
  })
}
