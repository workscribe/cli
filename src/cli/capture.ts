import { Command } from 'commander'
import { captureCommand } from '../capture'
import { debugLog } from '../utils/logger'

const CAPTURE_HANG_TIMEOUT_MS = 5_000

export function registerCapture(program: Command): void {
  // Internal command — called by the shell hook and IDE integrations, not by the user
  program
    .command('_capture')
    .description('Internal: capture a shell command or IDE event (called by shell hook or IDE plugin)')
    .option('--cmd <command>', 'command that was executed (shell events)')
    .option('--cwd <path>', 'working directory')
    .option('--exit <code>', 'exit code', parseInt)
    .option('--duration <ms>', 'duration in milliseconds', parseInt)
    .option('--git-before <sha>', 'git HEAD SHA before this command ran')
    .option('--type <type>', 'event type override — skips normalization (IDE integrations)')
    .option('--source <source>', 'event source identifier (e.g. vscode, neovim, jupyter)')
    .option('--file <path>', 'file path for code_edit events')
    .action((opts) => {
      // Prevent background process accumulation if the process hangs (e.g. SQLite locked).
      // unref() allows a natural exit to happen immediately without waiting for the timer.
      const hangGuard = setTimeout(() => process.exit(0), CAPTURE_HANG_TIMEOUT_MS)
      hangGuard.unref()

      // Never surface errors to the terminal — this runs silently in the background
      try {
        if (!opts.cwd) return
        // Require either a shell command or a typed IDE event
        if (!opts.cmd && !opts.type) return
        captureCommand({
          command: opts.cmd,
          cwd: opts.cwd,
          exitCode: opts.exit ?? null,
          durationMs: opts.duration ?? null,
          gitBefore: opts.gitBefore ?? undefined,
          source: opts.source ?? undefined,
          type: opts.type ?? undefined,
          file: opts.file ?? undefined,
        })
      } catch (err) {
        debugLog('_capture', err)
      }
    })
}
