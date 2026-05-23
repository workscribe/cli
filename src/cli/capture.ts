import { Command } from 'commander'
import { captureCommand } from '../capture'
import { debugLog } from '../utils/logger'

export function registerCapture(program: Command): void {
  // Internal command — called by the shell hook, not by the user
  program
    .command('_capture')
    .description('Internal: capture a shell command event (called by shell hook)')
    .option('--cmd <command>', 'command that was executed')
    .option('--cwd <path>', 'working directory')
    .option('--exit <code>', 'exit code', parseInt)
    .option('--duration <ms>', 'duration in milliseconds', parseInt)
    .action((opts) => {
      // Never surface errors to the terminal — this runs silently in the background
      try {
        if (!opts.cmd || !opts.cwd) return
        captureCommand({
          command: opts.cmd,
          cwd: opts.cwd,
          exitCode: opts.exit ?? null,
          durationMs: opts.duration ?? null,
        })
      } catch (err) {
        debugLog('_capture', err)
      }
    })
}
