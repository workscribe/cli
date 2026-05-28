export interface AIHookIntegration {
  /** Display name shown in prompts and log messages */
  displayName: string
  /** Returns true if the AI tool CLI is available on PATH */
  isInstalled(): boolean
  /** Returns true if the workscribe hook is already wired into the tool */
  isHookInstalled(): boolean
  /** Install the workscribe hook — safe to call multiple times */
  install(): void
}
