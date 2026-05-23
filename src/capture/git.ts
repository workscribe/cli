import { execSync } from 'child_process'
import path from 'path'

export interface GitContext {
  repoName: string | null
  branch: string | null
}

export function getGitContext(cwd: string): GitContext {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd,
      timeout: 2000,
      stdio: 'pipe',
    })
      .toString()
      .trim()

    const repoName = path.basename(root)

    let branch: string | null = null
    try {
      branch = execSync('git branch --show-current', {
        cwd,
        timeout: 2000,
        stdio: 'pipe',
      })
        .toString()
        .trim() || null
    } catch {
      // Detached HEAD or not a git repo
    }

    return { repoName, branch }
  } catch {
    return { repoName: null, branch: null }
  }
}
