import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import type { AIHookIntegration, HookUninstallOutcome } from './types'
import { isCommandInstalled } from './utils'
import { resolveWorkscribeBinary } from '../shell-hook'
import { backUpFile } from '../../utils/backup'
import { buildHookCommand, HOOK_MARKER, isGuardedCommand, isPinnedCommand, pinnedNodePath } from './claude-code-command'

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

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
  /** Every Workscribe hook exits silently when the binary is gone (false for hooks from Workscribe ≤ 2.0.0). */
  guarded: boolean
  /** A pinned hook's Node interpreter no longer exists (e.g. removed by a version manager) — capture is off. */
  nodeMissing: boolean
  /** Only meaningful when installed && !pinned; null otherwise. */
  confirmedBroken: boolean | null
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

function allWorkscribeCommands(): string[] {
  const { postToolUse, userPromptSubmit } = findWorkscribeHookCommands(readSettings())
  return [...postToolUse, ...userPromptSubmit]
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
  const allCommands = allWorkscribeCommands()
  if (allCommands.length === 0) {
    return { installed: false, pinned: true, guarded: true, nodeMissing: false, confirmedBroken: null }
  }

  const guarded = allCommands.every(isGuardedCommand)
  const nodePaths = allCommands.map(pinnedNodePath).filter((nodePath): nodePath is string => nodePath !== null)
  const nodeMissing = nodePaths.some((nodePath) => !isExecutable(nodePath))
  if (allCommands.every(isPinnedCommand)) {
    return { installed: true, pinned: true, guarded, nodeMissing, confirmedBroken: null }
  }

  let confirmedBroken: boolean
  try {
    execFileSync('workscribe', ['--version'], { stdio: 'ignore', timeout: 2000 })
    confirmedBroken = false
  } catch {
    confirmedBroken = true
  }

  return { installed: true, pinned: false, guarded, nodeMissing, confirmedBroken }
}

/** Reads settings.json without forgiving a parse error — uninstall must never overwrite a file it couldn't read. */
function readSettingsStrictly(): Record<string, unknown> | 'missing' | 'unreadable' {
  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return 'missing'
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : 'unreadable'
  } catch {
    return 'unreadable'
  }
}

/** The hooks object with Workscribe's entries removed, empty event arrays dropped — or null if there were none. */
function hooksWithoutWorkscribe(hooks: Record<string, unknown>): Record<string, unknown> | null {
  let removedAny = false
  const remaining: Record<string, unknown> = {}
  for (const [eventName, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      remaining[eventName] = entries
      continue
    }
    const kept = withoutWorkscribeEntries(entries)
    if (commandsForEvent(hooks, eventName).length > 0) removedAny = true
    if (kept.length > 0) remaining[eventName] = kept
  }
  return removedAny ? remaining : null
}

/**
 * Both events have a Workscribe hook, and every one is pinned, guarded, and pinned to a Node.js that still exists.
 * The guard keeps a hook whose Node a version manager removed quiet — and so quietly broken — unless `init` sees it.
 */
function isHookCurrent(): boolean {
  const { postToolUse, userPromptSubmit } = findWorkscribeHookCommands(readSettings())
  if (postToolUse.length === 0 || userPromptSubmit.length === 0) return false
  return [...postToolUse, ...userPromptSubmit].every((command) => {
    const nodePath = pinnedNodePath(command)
    return isPinnedCommand(command) && isGuardedCommand(command) && nodePath !== null && isExecutable(nodePath)
  })
}

export const claudeCodeIntegration: AIHookIntegration = {
  displayName: 'Claude Code',

  isInstalled() {
    return isCommandInstalled('claude')
  },

  // "Installed" means a *current* hook is present, not just any workscribe hook — so `workscribe init` offers to
  // update a stale one (unpinned, unguarded, or pinned to a Node that's gone) through its outdated-hook prompt
  isHookInstalled() {
    return isHookCurrent()
  },

  install() {
    const settings = readSettings()
    const existingHooks = (settings.hooks ?? {}) as Record<string, unknown>
    const existingPostToolUse = withoutWorkscribeEntries((existingHooks.PostToolUse ?? []) as unknown[])
    const existingUserPromptSubmit = withoutWorkscribeEntries((existingHooks.UserPromptSubmit ?? []) as unknown[])

    const binaryPath = resolveWorkscribeBinary()
    const command = (args: string) => buildHookCommand({ nodePath: process.execPath, binaryPath, args })

    settings.hooks = {
      ...existingHooks,
      PostToolUse: [
        ...existingPostToolUse,
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: command(HOOK_MARKER), async: true }],
        },
      ],
      UserPromptSubmit: [
        ...existingUserPromptSubmit,
        {
          hooks: [
            {
              type: 'command',
              command: command(`${HOOK_MARKER} --event UserPromptSubmit`),
            },
          ],
        },
      ],
    }
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true })
    fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2))
  },

  // Some workscribe hook is present, but not all of them are current (pinned and guarded) — including a
  // half-installed one where only PostToolUse or only UserPromptSubmit exists
  isHookOutdated() {
    return allWorkscribeCommands().length > 0 && !isHookCurrent()
  },

  uninstall(): HookUninstallOutcome {
    const settings = readSettingsStrictly()
    if (settings === 'missing') return 'not-installed'
    if (settings === 'unreadable') return 'unreadable'
    const hooks = settings.hooks
    if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) return 'not-installed'
    const remainingHooks = hooksWithoutWorkscribe(hooks as Record<string, unknown>)
    if (!remainingHooks) return 'not-installed'

    const updated: Record<string, unknown> = { ...settings, hooks: remainingHooks }
    if (Object.keys(remainingHooks).length === 0) delete updated.hooks
    backUpFile(CLAUDE_SETTINGS_PATH)
    fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(updated, null, 2))
    return 'removed'
  },
}
