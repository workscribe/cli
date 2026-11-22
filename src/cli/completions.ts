import { Command } from 'commander'
import { log } from '../utils/logger'
import { CompletionCommand, bashCompletion, zshCompletion, fishCompletion } from '../utils/completion-scripts'

export type { CompletionCommand }
export { bashCompletion, zshCompletion, fishCompletion }

export const HIDDEN_COMMANDS = new Set(['_capture', '_hook'])

// _capture/_hook fire on every shell command as a detached background process
// that must never add latency — startup checks (the update check) skip
// those outright rather than relying on a cache alone.
export function shouldRunStartupChecks(invokedCommand: string | undefined): boolean {
  if (invokedCommand === undefined) return true
  return !HIDDEN_COMMANDS.has(invokedCommand)
}

// Data jobs (src/db/jobs/) run only before these: commands people type that read the data. Never the background
// _capture/_hook, never `context` (the editor calls it with a 5 s timeout), never `sessions` (the agent skill calls
// it), and never commands that remove or reset the database (`uninstall`, `clear`, `init`).
export const DATA_JOB_COMMANDS = new Set(['status', 'summary', 'week', 'export', 'events', 'history', 'upgrade'])
// The extension detects the CLI with `--version` on a 2 s timeout; help output should never wait on a backup either
const INFORMATION_FLAGS = new Set(['--version', '-V', '--help', '-h'])

export function shouldRunDataJobs(args: readonly string[]): boolean {
  const [command] = args
  if (command === undefined || !DATA_JOB_COMMANDS.has(command)) return false
  return !args.some((arg) => INFORMATION_FLAGS.has(arg))
}

export function getPublicCommands(program: Command): CompletionCommand[] {
  return program.commands
    .filter((command) => !HIDDEN_COMMANDS.has(command.name()))
    .map((command) => ({ name: command.name(), description: command.description() }))
}

export function registerCompletions(program: Command): void {
  program
    .command('completions [shell]')
    .description('Print shell completion script (bash, zsh, fish)')
    .action((shell?: string) => {
      const detected = shell ?? (process.env.SHELL ?? '').split('/').at(-1)

      if (!detected || !['bash', 'zsh', 'fish'].includes(detected)) {
        log.error(`Unknown shell: "${detected ?? ''}". Supported: bash, zsh, fish`)
        log.plain(`  Usage: workscribe completions <bash|zsh|fish>`)
        process.exit(1)
      }

      const commands = getPublicCommands(program)
      const script =
        detected === 'bash'
          ? bashCompletion(commands)
          : detected === 'zsh'
            ? zshCompletion(commands)
            : fishCompletion(commands)

      process.stdout.write(script + '\n')
    })
}
