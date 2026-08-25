import { Command } from 'commander'
import { captureCommand } from '../capture'
import { readConfig } from '../config'
import { debugLog } from '../utils/logger'
import { containsSecrets } from '../capture/detect-secrets'
import { insertAlert } from '../db/alerts'

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

interface UserPromptPayload {
  session_id: string
  prompt: string
  cwd: string
}

/** Parses a Claude Code UserPromptSubmit stdin payload. Returns null if required fields are missing. */
export function parseUserPromptPayload(raw: string): UserPromptPayload | null {
  if (!raw.trim()) return null
  const payload = JSON.parse(raw) as Record<string, unknown>
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : null
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : ''
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : ''
  if (!prompt) return null
  return { session_id: sessionId, prompt, cwd }
}

export function registerHook(program: Command): void {
  // Internal command — called by AI tool hooks (e.g. Claude Code PostToolUse), not by the user
  program
    .command('_hook')
    .description('Internal: capture events from AI tool hooks (stdin JSON payload)')
    .option('--source <source>', 'hook source identifier (e.g. claude-code)')
    .option('--event <event>', 'hook event type (PostToolUse or UserPromptSubmit)', 'PostToolUse')
    .action((opts: { source?: string; event: string }) => {
      let raw = ''
      process.stdin.setEncoding('utf-8')
      process.stdin.on('data', (chunk: string) => {
        raw += chunk
      })
      process.stdin.on('end', () => {
        try {
          if (opts.event === 'UserPromptSubmit') {
            const parsed = parseUserPromptPayload(raw)
            if (!parsed) return
            if (containsSecrets(parsed.prompt)) {
              insertAlert(
                opts.source ?? 'unknown',
                parsed.session_id || null,
                'Possible credential detected in prompt submitted to AI tool'
              )
              // Claude Code reads this JSON and injects systemMessage into Claude's context
              process.stdout.write(
                JSON.stringify({
                  systemMessage:
                    'Workscribe detected a possible credential in your prompt. ' +
                    'Run `workscribe alerts` for details.',
                })
              )
            }
            return
          }

          // Default: PostToolUse — capture the shell command
          if (readConfig().capture.aiTools === false) return
          const parsed = parseHookPayload(raw)
          if (!parsed) return
          captureCommand({
            command: parsed.command,
            cwd: parsed.cwd,
            exitCode: null,
            durationMs: null,
            source: opts.source,
          })
        } catch (err) {
          debugLog('_hook', err)
        }
      })
    })
}
