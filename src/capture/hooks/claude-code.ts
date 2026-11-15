import path from 'path'
import os from 'os'
import type { AIHookIntegration, HookInstallOutcome, HookUninstallOutcome } from './types'
import { isCommandInstalled } from './utils'
import { resolveWorkscribeBinary } from '../shell-hook'
import { readJsonConfig, writeJsonConfig } from './config-file'
import { healthOfCommands, isExecutable, type HookHealth } from './hook-health'
import { parseClaudeHook } from './claude-code-payload'
import {
  buildHookCommand,
  hookMarker,
  isGuardedCommand,
  isPinnedCommand,
  isWorkscribeHook,
  pinnedNodePath,
} from './hook-command'

const SOURCE = 'claude-code'
const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

/** One Workscribe hook entry in Claude Code's settings: the event, what it matches, and how it runs. */
interface ExpectedHook {
  event: string
  /** Tool events only: which tools fire it. Session events take none */
  matcher?: string
  /** Doesn't hold Claude Code up. UserPromptSubmit waits, because it can warn about a credential in the prompt */
  async: boolean
}

// Edits as well as commands: a finished Bash call, or a file the agent changed (WOR-136). Failures stay Bash-only,
// because a failed edit changed nothing
const TOOL_MATCHER = 'Bash|Edit|Write|MultiEdit|NotebookEdit'
const FAILURE_MATCHER = 'Bash'

const EXPECTED_HOOKS: ExpectedHook[] = [
  { event: 'PostToolUse', matcher: TOOL_MATCHER, async: true },
  // Failed Bash calls only fire this one, with the exit code in `error` — PostToolUse alone never sees a failure
  { event: 'PostToolUseFailure', matcher: FAILURE_MATCHER, async: true },
  { event: 'UserPromptSubmit', async: false },
  // How a session ended, and the agent's own recaps when capture.agentMessages is on. An async SessionEnd hook still
  // runs to the end when Claude Code 2.1.319 exits: see session-end-async.json in
  // tests/fixtures/agent-hooks/claude-code/2.1.319/
  { event: 'Stop', async: true },
  { event: 'PostCompact', async: true },
  { event: 'SessionEnd', async: true },
]

/** The `_hook` arguments for an event; PostToolUse is the default, so its command stays as it always was. */
function hookArgs(event: string): string {
  return event === 'PostToolUse' ? hookMarker(SOURCE) : `${hookMarker(SOURCE)} --event ${event}`
}

/** The settings for reading only: a missing or unparseable file counts as having no hooks. */
function readSettings(): Record<string, unknown> {
  const config = readJsonConfig(CLAUDE_SETTINGS_PATH)
  return config.kind === 'ok' ? config.value : {}
}

/** A Workscribe command in the settings, with the matcher of the entry holding it (undefined when it has none). */
interface WorkscribeHook {
  command: string
  matcher: unknown
}

function workscribeHooksForEvent(hooks: Record<string, unknown>, eventName: string): WorkscribeHook[] {
  const entries = Array.isArray(hooks[eventName]) ? (hooks[eventName] as unknown[]) : []
  return entries.flatMap((entry) => {
    const record = entry as Record<string, unknown>
    const entryHooks = Array.isArray(record.hooks) ? (record.hooks as unknown[]) : []
    return entryHooks.flatMap((hookItem) => {
      const command = (hookItem as Record<string, unknown>).command
      return typeof command === 'string' && isWorkscribeHook(command, SOURCE)
        ? [{ command, matcher: record.matcher }]
        : []
    })
  })
}

function commandsForEvent(hooks: Record<string, unknown>, eventName: string): string[] {
  return workscribeHooksForEvent(hooks, eventName).map((hook) => hook.command)
}

/** Workscribe's hooks for each event it installs, by event. */
function findWorkscribeHooks(settings: Record<string, unknown>): Map<string, WorkscribeHook[]> {
  const hooks = (settings.hooks ?? {}) as Record<string, unknown>
  return new Map(EXPECTED_HOOKS.map(({ event }) => [event, workscribeHooksForEvent(hooks, event)]))
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
        return !(typeof hook.command === 'string' && isWorkscribeHook(hook.command, SOURCE))
      })
      return { ...record, hooks: filteredHooks }
    })
    .filter((entry) => ((entry as Record<string, unknown>).hooks as unknown[]).length > 0)
}

function allWorkscribeCommands(): string[] {
  return [...findWorkscribeHooks(readSettings()).values()].flat().map((hook) => hook.command)
}

/** The installed hook's health: pinned or bare, guarded, its Node.js still there, and for a bare one whether it works. */
export function checkHookHealth(): HookHealth {
  return healthOfCommands(allWorkscribeCommands())
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

function isCommandCurrent(command: string): boolean {
  const nodePath = pinnedNodePath(command)
  return isPinnedCommand(command) && isGuardedCommand(command) && nodePath !== null && isExecutable(nodePath)
}

/**
 * Every event has a Workscribe hook, a tool event's hooks match the tools they should, and every command is pinned,
 * guarded, and pinned to a Node.js that still exists. The guard keeps a hook whose Node a version manager removed
 * quiet — and so quietly broken — unless `init` sees it.
 */
function isHookCurrent(): boolean {
  const hooksByEvent = findWorkscribeHooks(readSettings())
  // An install missing an event, or matching only Bash (before WOR-136), is outdated
  return EXPECTED_HOOKS.every(({ event, matcher }) => {
    const hooks = hooksByEvent.get(event) ?? []
    if (hooks.length === 0) return false
    return hooks.every((hook) => (matcher === undefined || hook.matcher === matcher) && isCommandCurrent(hook.command))
  })
}

export const claudeCodeIntegration: AIHookIntegration = {
  displayName: 'Claude Code',
  source: SOURCE,
  settingsPath: '~/.claude/settings.json',
  parse: parseClaudeHook,

  isInstalled() {
    return isCommandInstalled('claude')
  },

  // "Installed" means a *current* hook is present, not just any workscribe hook — so `workscribe init` offers to
  // update a stale one (unpinned, unguarded, or pinned to a Node that's gone) through its outdated-hook prompt
  isHookInstalled() {
    return isHookCurrent()
  },

  install(): HookInstallOutcome {
    const config = readJsonConfig(CLAUDE_SETTINGS_PATH)
    // A file we can't parse is the user's: writing over it would lose whatever it holds
    if (config.kind === 'unreadable') return 'unreadable'
    const settings = config.kind === 'ok' ? { ...config.value } : {}
    const existingHooks = (settings.hooks ?? {}) as Record<string, unknown>
    const binaryPath = resolveWorkscribeBinary()
    const command = (args: string) => buildHookCommand({ nodePath: process.execPath, binaryPath, args })

    const workscribeHooks = Object.fromEntries(
      EXPECTED_HOOKS.map(({ event, matcher, async }) => {
        const others = withoutWorkscribeEntries((existingHooks[event] ?? []) as unknown[])
        const hook = { type: 'command', command: command(hookArgs(event)), ...(async ? { async: true } : {}) }
        return [event, [...others, { ...(matcher === undefined ? {} : { matcher }), hooks: [hook] }]]
      })
    )
    settings.hooks = { ...existingHooks, ...workscribeHooks }
    writeJsonConfig(CLAUDE_SETTINGS_PATH, settings)
    return 'installed'
  },

  checkHealth: checkHookHealth,

  // Some workscribe hook is present, but not all of them are current (pinned, guarded, matching the right tools) —
  // including a half-installed one, or one from before an event was added
  isHookOutdated() {
    return allWorkscribeCommands().length > 0 && !isHookCurrent()
  },

  uninstall(): HookUninstallOutcome {
    const config = readJsonConfig(CLAUDE_SETTINGS_PATH)
    if (config.kind === 'missing') return 'not-installed'
    if (config.kind === 'unreadable') return 'unreadable'
    const settings = config.value
    const hooks = settings.hooks
    if (hooks === null || typeof hooks !== 'object' || Array.isArray(hooks)) return 'not-installed'
    const remainingHooks = hooksWithoutWorkscribe(hooks as Record<string, unknown>)
    if (!remainingHooks) return 'not-installed'

    const updated: Record<string, unknown> = { ...settings, hooks: remainingHooks }
    if (Object.keys(remainingHooks).length === 0) delete updated.hooks
    writeJsonConfig(CLAUDE_SETTINGS_PATH, updated)
    return 'removed'
  },
}
