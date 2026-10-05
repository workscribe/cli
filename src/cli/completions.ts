import { Command } from 'commander'
import { log } from '../utils/logger'
import { CompletionCommand, bashCompletion, zshCompletion, fishCompletion } from '../utils/completion-scripts'

export type { CompletionCommand }
export { bashCompletion, zshCompletion, fishCompletion }

export const HIDDEN_COMMANDS = new Set(['_capture', '_hook'])

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
