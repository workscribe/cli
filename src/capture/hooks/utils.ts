import { execSync } from 'child_process'

/** Returns true if the given CLI command is available on PATH */
export function isCommandInstalled(cmd: string): boolean {
  try {
    execSync(`which ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
