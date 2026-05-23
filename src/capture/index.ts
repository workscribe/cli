import { insertEvent, getLastEvent } from '../db'
import { redact } from './redact'
import { getGitContext } from './git'
import { normalizeCommand } from '../normalize/patterns'
import { readConfig } from '../config'
import { shouldFilter, isDuplicate } from './filter'

export function captureCommand(opts: {
  command: string
  cwd: string
  exitCode: number | null
  durationMs: number | null
}): void {
  const config = readConfig()
  const { command, cwd, exitCode, durationMs } = opts

  // 1. Filter noise commands
  if (shouldFilter(command, config.capture.ignore)) return

  // 2. Deduplicate: same command + same cwd within 5 seconds
  const last = getLastEvent()
  if (isDuplicate(command, cwd, last ?? undefined)) return

  // 3. Redact sensitive patterns
  const safeCommand = redact(normalized, config.redact.extra)

  // 4. Extract git context
  const { repoName, branch } = getGitContext(cwd)

  // 5. Normalize to typed event
  const { category, metadata } = normalizeCommand(safeCommand)

  // 6. Persist
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
  })
}
