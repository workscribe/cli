import type { HookEvent } from './event'
import type { HookHealth } from './hook-health'

/**
 * Which of an agent's actions another capture path also records (WOR-160), so one action is one event. Each is set from
 * a measured run (`tests/fixtures/agent-hooks/README.md`); an agent that overlaps with nothing leaves them off.
 */
export interface HookOverlaps {
  /** Its terminal commands also reach the shell hook, as a row with no source */
  shellCommands?: boolean
  /** Its edits also trigger the editor's save event */
  editorSaves?: boolean
}

export interface AIHookIntegration {
  /** Display name shown in prompts and log messages */
  displayName: string
  /** The `--source` its hooks report: the registry's `hook` value, and what its events are stored under */
  source: string
  /** The file the hooks are written to, as shown to people (`~/.claude/settings.json`) */
  settingsPath: string
  /**
   * Whether capture checks a `git commit` that reports no outcome against git's `HEAD`. For an agent whose hooks
   * carry no failure signal for commands (WOR-154 measured that for Antigravity CLI and Copilot in VS Code); off for
   * the rest. Antigravity turns it on; Copilot in VS Code will (WOR-164).
   */
  checksCommits?: boolean
  /** What its actions overlap with. No integration sets it yet: each agent's ticket turns on what it measured */
  overlaps?: HookOverlaps
  /** Reads one hook payload into the shared shape, or null when it isn't one to store. Throws on invalid JSON */
  parse(raw: string, event: string): HookEvent | null
  /** Returns true if the AI tool CLI is available on PATH */
  isInstalled(): boolean
  /** Returns true if the workscribe hook is already wired into the tool */
  isHookInstalled(): boolean
  /** Install the workscribe hook — safe to call multiple times. Never overwrites a settings file it can't parse */
  install(): HookInstallOutcome
  /** A workscribe hook is present but from an older version (or half-installed) — `init` offers to update it */
  isHookOutdated?(): boolean
  /** Whether the installed hook is pinned, guarded and has its Node.js */
  checkHealth(): HookHealth
  /** Remove the workscribe hook, leaving everything else in the tool's settings untouched */
  uninstall(): HookUninstallOutcome
}

/** `unreadable`: the tool's settings file couldn't be parsed, so it was left alone. */
export type HookInstallOutcome = 'installed' | 'unreadable'
export type HookUninstallOutcome = 'removed' | 'not-installed' | 'unreadable'
