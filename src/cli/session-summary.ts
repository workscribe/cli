import { Command } from 'commander'
import { saveThreadSummary } from '../db'
import { readConfig } from '../config'
import { redact } from '../capture/redact'
import { log } from '../utils/logger'
import { localDateOf } from '../utils/format'
import { SKILL_ENGINE, parseSessionKey } from '../summary/store'
import { anchorOfThread } from '../summary/anchors'
import { INTERACTIVE_STDIN_MESSAGE, stdinReadFailedMessage, validateSkillSummary } from '../summary/write-back'
import { isStdinInteractive, readAllStdin } from '../utils/stdin'
import { loadDayThreads, requireThreadData } from './thread-day'
import { fail } from './fail'
import type { DayThread } from '../db/day-threads'

// `workscribe sessions summary set` — how the Workscribe agent skill saves the summary it wrote.

/** The thread a key from `sessions --json` names, after rebuilding its day so the lookup is current. */
function findThreadByKey(key: string): DayThread | null {
  const parsed = parseSessionKey(key)
  if (!parsed) return null
  const threads = loadDayThreads(localDateOf(parsed.startedAt)).flatMap((block) => block.threads)
  return threads.find((thread) => thread.key === key) ?? null
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
  requireThreadData()

  const summaryText = readSummaryText()
  const problem = validateSkillSummary(summaryText)
  if (problem) fail(problem)

  const thread = findThreadByKey(options.key)
  if (!thread) {
    fail(
      'No session matches this key — your activity may have changed since the sessions were listed. ' +
        'Run workscribe sessions --json again and use the new key.'
    )
  }

  const text = redact(summaryText.trim(), readConfig().redact.extra)
  saveThreadSummary(options.key, {
    engine: SKILL_ENGINE,
    text,
    anchor: anchorOfThread(thread.events, thread.projectId),
  })
  log.success(
    `Saved the summary for ${thread.repoName ?? 'this session'} — workscribe summary, workscribe context and the VS Code status bar now show it.`
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
