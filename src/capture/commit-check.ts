// For an agent whose hooks send no failure signal for commands: whether a `git commit` it ran really committed,
// told by comparing the message it named with git's `HEAD`. Pure.
import { FAILED_EXIT_CODE } from './hooks/event'

/** A commit message's subject: its first line. */
export function commitSubjectOf(message: string): string {
  return message.split('\n')[0].trim()
}

interface CommitCheck {
  /** The code the hook reported: only a command with none is checked */
  exitCode: number | null
  category: string
  metadata: Record<string, unknown>
  /** The subject of the commit `HEAD` points to now, or null when git couldn't say */
  headSubject: string | null
}

/**
 * The exit code to store for a commit that reported none: `FAILED_EXIT_CODE` when `HEAD` isn't the commit the command named, so
 * a rejected commit (a hook, nothing staged) doesn't read as "Committed:". A commit that landed, one with no message
 * to compare (`--amend --no-edit`) and one git couldn't be asked about stay unknown. Never changes a known code.
 */
export function exitCodeAfterCommitCheck({ exitCode, category, metadata, headSubject }: CommitCheck): number | null {
  if (exitCode !== null || category !== 'shipping' || headSubject === null) return exitCode
  const message = metadata.message
  if (typeof message !== 'string' || commitSubjectOf(message) === '') return exitCode
  return commitSubjectOf(message) === commitSubjectOf(headSubject) ? exitCode : FAILED_EXIT_CODE
}
