import { Command } from 'commander'
import { captureCommand } from '../capture'
import { debugLog } from '../utils/logger'

const CAPTURE_HANG_TIMEOUT_MS = 5_000

export function registerCapture(program: Command): void {
  // Internal command — called by the shell hook, not by the user
  program
    .command('_capture')
    .description('Internal: capture a shell command event (called by shell hook)')
    .option('--cmd <command>', 'command that was executed')
    .option('--cwd <path>', 'working directory')
    .option('--exit <code>', 'exit code', parseInt)
    .option('--duration <ms>', 'duration in milliseconds', parseInt)
    .option('--git-before <sha>', 'git HEAD SHA before this command ran')
    .action((opts) => {
      // Prevent background process accumulation if the process hangs (e.g. SQLite locked).
      // unref() allows a natural exit to happen immediately without waiting for the timer.
      const hangGuard = setTimeout(() => process.exit(0), CAPTURE_HANG_TIMEOUT_MS)
      hangGuard.unref()

      // Never surface errors to the terminal — this runs silently in the background
      try {
        if (!opts.cmd || !opts.cwd) return
        captureCommand({
          command: opts.cmd,
          cwd: opts.cwd,
          exitCode: opts.exit ?? null,
          durationMs: opts.duration ?? null,
          gitBefore: opts.gitBefore ?? undefined,
        })
      } catch (err) {
        debugLog('_capture', err)
      }
    })
}
