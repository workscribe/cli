import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

export interface GitContext {
  repoName: string | null
  branch: string | null
}

// Handles SSH (git@host:owner/repo.git), HTTPS (https://host/owner/repo.git),
// and bare git:// / ssh:// forms uniformly by normalizing the SSH scp-like
// syntax's first ':' to '/' (but not the '://' in URLs with a real scheme),
// then splitting on '/'.
function parseOwnerAndRepo(url: string): { owner: string; repo: string } | null {
  const normalized = url.trim().replace(/^[^/]+:(?!\/\/)/, (match) => match.replace(':', '/'))
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const repo = segments[segments.length - 1].replace(/\.git$/, '')
  const owner = segments[segments.length - 2]
  return owner && repo ? { owner, repo } : null
}

function nameFromRemote(root: string, qualifyWithOwner: boolean): string | null {
  try {
    const url = execSync('git remote get-url origin', {
      cwd: root,
      timeout: 2000,
      stdio: 'pipe',
    })
      .toString()
      .trim()
    const parsed = parseOwnerAndRepo(url)
    if (!parsed) return null
    return qualifyWithOwner ? `${parsed.owner}/${parsed.repo}` : parsed.repo
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

export function getGitContext(cwd: string, nameOverride?: string | null, qualifyRepoName = false): GitContext {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd,
      timeout: 2000,
      stdio: 'pipe',
    })
      .toString()
      .trim()

    const repoName =
      nameOverride ?? nameFromRemote(root, qualifyRepoName) ?? nameFromPackageJson(root) ?? path.basename(root)

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
