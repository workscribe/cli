import fs from 'fs'
import { execFileSync } from 'child_process'
import { isGuardedCommand, isPinnedCommand, pinnedNodePath } from './hook-command'

export interface HookHealth {
  installed: boolean
  pinned: boolean
  /** Every Workscribe hook exits silently when the binary is gone (false for hooks from Workscribe ≤ 2.0.0). */
  guarded: boolean
  /** A pinned hook's Node interpreter no longer exists (e.g. removed by a version manager) — capture is off. */
  nodeMissing: boolean
  /** Only meaningful when installed && !pinned; null otherwise. */
  confirmedBroken: boolean | null
}

export function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Whether an agent's installed hook commands use the pinned (safe) or bare (vulnerable to Node-version/PATH drift)
 * form, and — for bare commands only — a live probe of whether they're actually broken right now. The probe is
 * best-effort: it inherits this process's own environment, which can't perfectly replicate whatever environment the
 * agent invokes hooks in, but a failure here is still strong evidence of a real, current problem.
 */
export function healthOfCommands(commands: string[]): HookHealth {
  if (commands.length === 0) {
    return { installed: false, pinned: true, guarded: true, nodeMissing: false, confirmedBroken: null }
  }

  const guarded = commands.every(isGuardedCommand)
  const nodePaths = commands.map(pinnedNodePath).filter((nodePath): nodePath is string => nodePath !== null)
  const nodeMissing = nodePaths.some((nodePath) => !isExecutable(nodePath))
  if (commands.every(isPinnedCommand))
    return { installed: true, pinned: true, guarded, nodeMissing, confirmedBroken: null }

  let confirmedBroken: boolean
  try {
    execFileSync('workscribe', ['--version'], { stdio: 'ignore', timeout: 2000 })
    confirmedBroken = false
  } catch {
    confirmedBroken = true
  }
  return { installed: true, pinned: false, guarded, nodeMissing, confirmedBroken }
}
