import { Command } from 'commander'
import { getOrBuildSessions } from '../sessions/detector'
import { saveSessionSummary } from '../db'
import { readConfig } from '../config'
import { redact } from '../capture/redact'
import { log } from '../utils/logger'
import { localDateOf } from '../utils/format'
import { SKILL_ENGINE, parseSessionKey, sessionKey } from '../summary/store'
import { anchorOfKeyedSession } from '../summary/anchors'
import { INTERACTIVE_STDIN_MESSAGE, stdinReadFailedMessage, validateSkillSummary } from '../summary/write-back'
import { isStdinInteractive, readAllStdin } from '../utils/stdin'
import type { Session } from '../sessions/detector'

// `workscribe sessions summary set` — how the Workscribe agent skill saves the summary it wrote.

function fail(message: string): never {
  log.error(message)
  process.exit(1)
}

/** The session a key from `sessions --json` names, after rebuilding its day so the lookup is current. */
function findSessionByKey(key: string): Session | null {
  const parsed = parseSessionKey(key)
  if (!parsed) return null
  return (
    getOrBuildSessions(localDateOf(parsed.startedAt)).find(
      (session) => sessionKey(session.repoName, session.startedAt) === key
    ) ?? null
  )
}

/** The summary text piped in, failing with a friendly message for a terminal or a read error. */
function readSummaryText(): string {
  if (isStdinInteractive()) fail(INTERACTIVE_STDIN_MESSAGE)
  try {
    return readAllStdin()
  } catch (error) {
    fail(stdinReadFailedMessage(error))
  }
}

function saveSkillSummary(options: { key: string }): void {
  if (!parseSessionKey(options.key)) {
    fail(`That session key isn't valid: '${options.key}'. Copy a session's "key" from workscribe sessions --json.`)
  }

  const summaryText = readSummaryText()
  const problem = validateSkillSummary(summaryText)
  if (problem) fail(problem)

  const session = findSessionByKey(options.key)
  if (!session) {
    fail(
      'No session matches this key — your activity may have changed since the sessions were listed. ' +
        'Run workscribe sessions --json again and use the new key.'
    )
  }

  const text = redact(summaryText.trim(), readConfig().redact.extra)
  // Anchored to the session's events too, so it survives regrouping. If they aren't linked to a project yet, the
  // project is left empty; the summary-anchors data job fills it in only if it hasn't already finished
  const anchor = anchorOfKeyedSession(session.events, options.key)
  saveSessionSummary(options.key, { engine: SKILL_ENGINE, text, anchor })
  log.success(
    `Saved the summary for ${session.repoName ?? 'this session'} — workscribe summary, workscribe context and the VS Code status bar now show it.`
  )
}

export function registerSummarySet(sessionsCommand: Command): void {
  sessionsCommand
    .command('summary')
    .description('Manage the summaries stored for sessions')
    .command('set')
    .description('Save a summary written by the Workscribe agent skill; the text is read from stdin')
    .requiredOption('--key <key>', 'the session key, from workscribe sessions --json')
    .action(saveSkillSummary)
}
