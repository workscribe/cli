export interface AIHookIntegration {
  /** Display name shown in prompts and log messages */
  displayName: string
  /** Returns true if the AI tool CLI is available on PATH */
  isInstalled(): boolean
  /** Returns true if the workscribe hook is already wired into the tool */
  isHookInstalled(): boolean
  /** Install the workscribe hook — safe to call multiple times */
  install(): void
  /** A workscribe hook is present but from an older version (or half-installed) — `init` offers to update it */
  isHookOutdated?(): boolean
  /** Remove the workscribe hook, leaving everything else in the tool's settings untouched */
  uninstall?(): HookUninstallOutcome
}

/** `unreadable`: the tool's settings file couldn't be parsed, so it was left alone. */
export type HookUninstallOutcome = 'removed' | 'not-installed' | 'unreadable'
