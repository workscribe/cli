import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

export interface GitContext {
  repoName: string | null
  branch: string | null
}

function nameFromRemote(root: string): string | null {
  try {
    const url = execSync('git remote get-url origin', {
      cwd: root,
      timeout: 2000,
      stdio: 'pipe',
    })
      .toString()
      .trim()
    const match = url.match(/\/([^/]+?)(?:\.git)?$/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

function nameFromPackageJson(root: string): string | null {
  try {
    const raw = fs.readFileSync(path.join(root, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as { name?: string }
    if (!pkg.name) return null
    return pkg.name.replace(/^@[^/]+\//, '')
  } catch {
    return null
  }
}

export function getGitContext(cwd: string, nameOverride?: string | null): GitContext {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd,
      timeout: 2000,
      stdio: 'pipe',
    })
      .toString()
      .trim()

    const repoName = nameOverride ?? nameFromRemote(root) ?? nameFromPackageJson(root) ?? path.basename(root)

    let branch: string | null = null
    try {
      branch =
        execSync('git branch --show-current', {
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
