import { Command } from 'commander'
import { dispatchHook } from '../capture/hooks/dispatch'

export function registerHook(program: Command): void {
  // Internal command — called by AI tool hooks (e.g. Claude Code PostToolUse), not by the user
  program
    .command('_hook')
    .description('Internal: capture events from AI tool hooks (stdin JSON payload)')
    .option('--source <source>', 'hook source identifier (e.g. claude-code)')
    .option(
      '--event <event>',
      'hook event type (PostToolUse, PostToolUseFailure, UserPromptSubmit, Stop, PostCompact or SessionEnd)',
      'PostToolUse'
    )
    .action((opts: { source?: string; event: string }) => {
      let raw = ''
      process.stdin.setEncoding('utf-8')
      process.stdin.on('data', (chunk: string) => {
        raw += chunk
      })
      process.stdin.on('end', () => dispatchHook(raw, opts.event, opts.source))
    })
}
