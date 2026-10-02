import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import type { AIHookIntegration } from './types'
import { isCommandInstalled } from './utils'
import { resolveWorkscribeBinary } from '../shell-hook'

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

// Identifies a workscribe hook entry regardless of whether it's the legacy
// bare `workscribe _hook ...` form or the pinned `"<node>" "<workscribe>" _hook ...`
// form below — both contain this exact substring.
const HOOK_MARKER = '_hook --source claude-code'

function readSettings(): Record<string, unknown> {
  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function commandsForEvent(hooks: Record<string, unknown>, eventName: string): string[] {
  const entries = (hooks[eventName] ?? []) as unknown[]
  const commands: string[] = []
  for (const entry of entries) {
    const entryHooks = ((entry as Record<string, unknown>).hooks ?? []) as unknown[]
    for (const hookItem of entryHooks) {
      const hook = hookItem as Record<string, unknown>
      if (typeof hook.command === 'string' && hook.command.includes(HOOK_MARKER)) {
        commands.push(hook.command)
      }
    }
  }
  return commands
}

function findWorkscribeHookCommands(settings: Record<string, unknown>): {
  postToolUse: string[]
  userPromptSubmit: string[]
} {
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>
  return {
    postToolUse: commandsForEvent(hooks, 'PostToolUse'),
    userPromptSubmit: commandsForEvent(hooks, 'UserPromptSubmit'),
  }
}

/**
 * A command is "pinned" if it starts with an absolute path (to a node
 * interpreter) rather than the bare `workscribe` string. Pinned commands are
 * immune to PATH/Node-version drift between install time and whatever
 * environment the hook actually fires in — the same class of hardening
 * WOR-75 applied to the shell hook, extended here to also cover the Node
 * interpreter itself, not just the workscribe script path.
 */
function isPinnedCommand(command: string): boolean {
  const trimmed = command.trimStart()
  return trimmed.startsWith('"') || trimmed.startsWith('/')
}

/**
 * Strips any existing workscribe hook entries out of a hooks array for one
 * event type, so install() can be called repeatedly — fresh install or
 * repairing a stale/unpinned one — without ever accumulating duplicates.
 */
function withoutWorkscribeEntries(entries: unknown[]): unknown[] {
  return entries
    .map((entry) => {
      const record = entry as Record<string, unknown>
      const entryHooks = (record.hooks ?? []) as unknown[]
      const filteredHooks = entryHooks.filter((hookItem) => {
        const hook = hookItem as Record<string, unknown>
        return !(typeof hook.command === 'string' && hook.command.includes(HOOK_MARKER))
      })
      return { ...record, hooks: filteredHooks }
    })
    .filter((entry) => ((entry as Record<string, unknown>).hooks as unknown[]).length > 0)
}

export interface ClaudeCodeHookHealth {
  installed: boolean
  pinned: boolean
  /** Only meaningful when installed && !pinned; null otherwise. */
  confirmedBroken: boolean | null
}

/**
 * Checks whether an installed Claude Code hook uses the pinned (safe) or
 * bare (vulnerable to Node-version/PATH drift) command form, and — for bare
 * commands only — attempts a live probe to confirm whether it's actually
 * broken right now. The probe is best-effort: it inherits this process's own
 * environment, which can't perfectly replicate whatever environment Claude
 * Code invokes hooks in, but a failure here is still strong evidence of a
 * real, currently-happening problem rather than a theoretical risk.
 */
export function checkHookHealth(): ClaudeCodeHookHealth {
  const { postToolUse, userPromptSubmit } = findWorkscribeHookCommands(readSettings())
  const allCommands = [...postToolUse, ...userPromptSubmit]
  if (allCommands.length === 0) return { installed: false, pinned: true, confirmedBroken: null }

  if (allCommands.every(isPinnedCommand)) return { installed: true, pinned: true, confirmedBroken: null }

  let confirmedBroken: boolean
  try {
    execFileSync('workscribe', ['--version'], { stdio: 'ignore', timeout: 2000 })
    confirmedBroken = false
  } catch {
    confirmedBroken = true
  }

  return { installed: true, pinned: false, confirmedBroken }
}

export const claudeCodeIntegration: AIHookIntegration = {
  displayName: 'Claude Code',

  isInstalled() {
    return isCommandInstalled('claude')
  },

  // "Installed" means a *correctly pinned* hook is present, not just any
  // workscribe hook — this is deliberate: it makes `workscribe init`'s
  // existing prompt-and-install flow naturally offer to repair a stale,
  // unpinned hook from before this fix, with no new UI code needed there.
  isHookInstalled() {
    const { postToolUse, userPromptSubmit } = findWorkscribeHookCommands(readSettings())
    if (postToolUse.length === 0 || userPromptSubmit.length === 0) return false
    return [...postToolUse, ...userPromptSubmit].every(isPinnedCommand)
  },

  install() {
    const settings = readSettings()
    const existingHooks = (settings.hooks ?? {}) as Record<string, unknown>
    const existingPostToolUse = withoutWorkscribeEntries((existingHooks.PostToolUse ?? []) as unknown[])
    const existingUserPromptSubmit = withoutWorkscribeEntries((existingHooks.UserPromptSubmit ?? []) as unknown[])

    const workscribeBinary = resolveWorkscribeBinary()
    const baseCommand = workscribeBinary ? `"${process.execPath}" "${workscribeBinary}"` : 'workscribe'

    settings.hooks = {
      ...existingHooks,
      PostToolUse: [
        ...existingPostToolUse,
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: `${baseCommand} ${HOOK_MARKER}`, async: true }],
        },
      ],
      UserPromptSubmit: [
        ...existingUserPromptSubmit,
        {
          hooks: [
            {
              type: 'command',
              command: `${baseCommand} ${HOOK_MARKER} --event UserPromptSubmit`,
            },
          ],
        },
      ],
    }
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true })
    fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2))
  },
}
