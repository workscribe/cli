import path from 'path'
import os from 'os'
import type { AIHookIntegration, HookInstallOutcome, HookUninstallOutcome } from './types'
import { isCommandInstalled } from './utils'
import { resolveWorkscribeBinary } from '../shell-hook'
import { readJsonConfig, writeJsonConfig } from './config-file'
import { healthOfCommands, isCommandCurrent, type HookHealth } from './hook-health'
import { parseAntigravityHook, WATCHED_TOOLS } from './antigravity-payload'
import { asRecord, stringOf, type Payload } from './payload'
import { buildHookCommand, hookMarker, isWorkscribeHook } from './hook-command'

const SOURCE = 'antigravity'
const HOOKS_PATH = path.join(os.homedir(), '.gemini', 'config', 'hooks.json')
/** The name of the hook Workscribe adds; the file's top-level keys are hook names. */
const HOOK_NAME = 'workscribe'
const TOOL_EVENT = 'PostToolUse'
/**
 * Seconds before Antigravity gives up on the hook. It blocks the agent, so a hung hook must not hold it for the
 * default 30 s; WOR-154 saw a 3 s timeout kill a 12 s hook, so the limit is enforced.
 */
const HOOK_TIMEOUT_SECONDS = 10

/** A Workscribe command in the file, with where it sits: its event, the tool its group matches, its timeout, and whether its hook is on. */
interface WorkscribeHook {
  command: string
  event: string
  matcher: unknown
  timeout: unknown
  enabled: boolean
}

/** The objects in a list; anything else in it isn't a hook Workscribe could have written. */
function records(values: unknown[]): Payload[] {
  return values.map(asRecord).filter((value): value is Payload => value !== null)
}

/** The handlers of one entry in an event's list: a group's `hooks`, or the entry itself when the list is flat. */
function handlersOf(entry: Payload): Payload[] {
  return Array.isArray(entry.hooks) ? records(entry.hooks) : [entry]
}

/** The command of a handler Workscribe wrote, or null for anyone else's. */
function ourCommandOf(handler: Payload): string | null {
  const command = stringOf(handler.command)
  return command !== null && isWorkscribeHook(command, SOURCE) ? command : null
}

function isOurs(handler: Payload): boolean {
  return ourCommandOf(handler) !== null
}

function entryHasOurs(entry: unknown): boolean {
  const record = asRecord(entry)
  return record !== null && handlersOf(record).some(isOurs)
}

/** Whether any event list of a named hook holds a Workscribe handler. `enabled` and the like are not event lists. */
function hookHasOurs(hook: Payload): boolean {
  return Object.values(hook).some((entries) => Array.isArray(entries) && entries.some(entryHasOurs))
}

/** The Workscribe commands in one entry of an event's list. */
function ourHooksIn(entry: Payload, event: string, enabled: boolean): WorkscribeHook[] {
  return handlersOf(entry).flatMap((handler) => {
    const command = ourCommandOf(handler)
    return command === null ? [] : [{ command, event, matcher: entry.matcher, timeout: handler.timeout, enabled }]
  })
}

function findWorkscribeHooks(config: Payload): WorkscribeHook[] {
  return Object.values(config).flatMap((value) => {
    const hook = asRecord(value)
    if (!hook) return []
    const enabled = hook.enabled !== false
    return Object.entries(hook).flatMap(([event, entries]) =>
      Array.isArray(entries) ? records(entries).flatMap((entry) => ourHooksIn(entry, event, enabled)) : []
    )
  })
}

/** An event's entries without Workscribe's handlers. Anything else in the list stays exactly as it was. */
function withoutOurHandlers(entries: unknown[]): unknown[] {
  return entries.flatMap((entry) => {
    const record = asRecord(entry)
    if (!record || !entryHasOurs(record)) return [entry]
    // A flat handler list holds the handler itself; a group holds them in `hooks`, and goes when none are left
    if (!Array.isArray(record.hooks)) return []
    const kept = record.hooks.filter((handler) => !isOurs(asRecord(handler) ?? {}))
    return kept.length > 0 ? [{ ...record, hooks: kept }] : []
  })
}

/** A hook holding Workscribe's handlers, without them: an event left empty goes, and so does a hook left with no events. */
function cleanedHook(hook: Payload): Payload | null {
  const cleaned = Object.fromEntries(
    Object.entries(hook).flatMap(([key, entries]) => {
      if (!Array.isArray(entries) || !entries.some(entryHasOurs)) return [[key, entries]]
      const kept = withoutOurHandlers(entries)
      return kept.length > 0 ? [[key, kept]] : []
    })
  )
  return Object.values(cleaned).some(Array.isArray) ? cleaned : null
}

/** The file's hooks with Workscribe's handlers removed. A hook that holds none, or isn't an object, is left as it is. */
function withoutWorkscribe(config: Payload): Payload {
  return Object.fromEntries(
    Object.entries(config).flatMap(([name, value]) => {
      const hook = asRecord(value)
      if (!hook || !hookHasOurs(hook)) return [[name, value]]
      const cleaned = cleanedHook(hook)
      return cleaned === null ? [] : [[name, cleaned]]
    })
  )
}

/** The `workscribe` hook without `enabled: false`: running `init` again is asking for capture to be on. */
function withoutDisabledFlag(hook: Payload): Payload {
  const { enabled, ...rest } = hook
  return enabled === false ? rest : hook
}

function ownGroups(): Payload[] {
  const command = buildHookCommand({
    nodePath: process.execPath,
    binaryPath: resolveWorkscribeBinary(),
    args: hookMarker(SOURCE),
  })
  const handler = { type: 'command', command, timeout: HOOK_TIMEOUT_SECONDS }
  return WATCHED_TOOLS.map((tool) => ({ matcher: tool, hooks: [handler] }))
}

/** The file for reading only: a missing or unparseable one counts as having no hooks. */
function readHooks(): Payload {
  const config = readJsonConfig(HOOKS_PATH)
  return config.kind === 'ok' ? config.value : {}
}

function allCommands(): string[] {
  return findWorkscribeHooks(readHooks()).map((hook) => hook.command)
}

/** The installed hook's health: pinned or bare, guarded, its Node.js still there, and for a bare one whether it works. */
export function checkHookHealth(): HookHealth {
  return healthOfCommands(allCommands())
}

/**
 * Every watched tool has a `PostToolUse` group matching exactly it, no Workscribe command sits anywhere else, its hook
 * is on, and every command has the timeout and is pinned, guarded, and pinned to a Node.js that still exists.
 */
function isHookCurrent(): boolean {
  const hooks = findWorkscribeHooks(readHooks())
  const inPlace = hooks.every(
    (hook) =>
      hook.enabled &&
      hook.event === TOOL_EVENT &&
      WATCHED_TOOLS.includes(String(hook.matcher)) &&
      hook.timeout === HOOK_TIMEOUT_SECONDS &&
      isCommandCurrent(hook.command)
  )
  return inPlace && WATCHED_TOOLS.every((tool) => hooks.some((hook) => hook.matcher === tool))
}

export const antigravityIntegration: AIHookIntegration = {
  displayName: 'Antigravity',
  source: SOURCE,
  settingsPath: '~/.gemini/config/hooks.json',
  // A command's `error` is empty even when it exited non-zero (WOR-154), so a commit that didn't land is checked
  checksCommits: true,
  parse: parseAntigravityHook,

  isInstalled() {
    return isCommandInstalled('agy')
  },

  isHookInstalled() {
    return isHookCurrent()
  },

  install(): HookInstallOutcome {
    const config = readJsonConfig(HOOKS_PATH)
    // A file we can't parse is the user's: writing over it would lose whatever it holds
    if (config.kind === 'unreadable') return 'unreadable'
    const others = withoutWorkscribe(config.kind === 'ok' ? config.value : {})
    // A `workscribe` entry that isn't a hook object, or whose `PostToolUse` isn't a list, is the user's: leave it be
    const existing = others[HOOK_NAME] === undefined ? {} : asRecord(others[HOOK_NAME])
    const earlier = existing?.[TOOL_EVENT] ?? []
    if (existing === null || !Array.isArray(earlier)) return 'unreadable'
    writeJsonConfig(HOOKS_PATH, {
      ...others,
      [HOOK_NAME]: { ...withoutDisabledFlag(existing), [TOOL_EVENT]: [...earlier, ...ownGroups()] },
    })
    return 'installed'
  },

  checkHealth: checkHookHealth,

  // Some Workscribe hook is present, but not all of them are current — half-installed, or from before a tool was added
  isHookOutdated() {
    return allCommands().length > 0 && !isHookCurrent()
  },

  uninstall(): HookUninstallOutcome {
    const config = readJsonConfig(HOOKS_PATH)
    if (config.kind === 'missing') return 'not-installed'
    if (config.kind === 'unreadable') return 'unreadable'
    if (findWorkscribeHooks(config.value).length === 0) return 'not-installed'
    writeJsonConfig(HOOKS_PATH, withoutWorkscribe(config.value))
    return 'removed'
  },
}
