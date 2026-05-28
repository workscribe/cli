import { Command } from 'commander'
import { captureCommand } from '../capture'
import { debugLog } from '../utils/logger'

/** Parses a Claude Code PostToolUse stdin payload. Returns null if required fields are missing. */
export function parseHookPayload(raw: string): { command: string; cwd: string } | null {
  if (!raw.trim()) return null
  const payload = JSON.parse(raw) as Record<string, unknown>
  const toolInput = payload.tool_input as Record<string, unknown> | undefined
  const command = typeof toolInput?.command === 'string' ? toolInput.command : null
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : null
  if (!command || !cwd) return null
  return { command, cwd }
}

export function registerHook(program: Command): void {
  // Internal command — called by AI tool hooks (e.g. Claude Code PostToolUse), not by the user
  program
    .command('_hook')
    .description('Internal: capture events from AI tool hooks (stdin JSON payload)')
    .option('--source <source>', 'hook source identifier (e.g. claude-code)')
    .action(() => {
      let raw = ''
      process.stdin.setEncoding('utf-8')
      process.stdin.on('data', (chunk: string) => { raw += chunk })
      process.stdin.on('end', () => {
        try {
          const parsed = parseHookPayload(raw)
          if (!parsed) return
          captureCommand({ command: parsed.command, cwd: parsed.cwd, exitCode: null, durationMs: null })
        } catch (err) {
          debugLog('_hook', err)
        }
      })
    })
}
