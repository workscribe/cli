import chalk from 'chalk'
import { FAILED_EXIT_CODE } from '../capture/hooks/event'

/** A failed command's mark: its exit code, or "failed" when it failed with no code known. Nothing for a pass or unknown. */
export function exitBadge(exitCode: number | null): string {
  if (exitCode === null || exitCode === 0) return ''
  return chalk.red(exitCode === FAILED_EXIT_CODE ? ' ✗ failed' : ` ✗${exitCode}`)
}
