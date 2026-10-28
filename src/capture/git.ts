import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import type { WorkscribeConfig } from '../config'
import { formatRepoName, parseOwnerAndRepo, type RemoteRepo } from './repo-name'

/** Everything known about the repo at a path — `root` and `remote` let `context` find the other name form too. */
export interface RepoContext {
  repoName: string | null
  branch: string | null
  root: string | null
  /** The `origin` remote, set only when `repoName` came from it (not an override, package.json or the folder) */
  remote: RemoteRepo | null
}

/** The settings that decide what a repo is called. */
export type RepoNamingConfig = Pick<WorkscribeConfig, 'projects' | 'git'>

const NOT_A_REPO: RepoContext = { repoName: null, branch: null, root: null, remote: null }

function remoteOf(root: string): RemoteRepo | null {
  try {
    const url = execSync('git remote get-url origin', {
      cwd: root,
      timeout: 2000,
      stdio: 'pipe',
    })
      .toString()
      .trim()
    return parseOwnerAndRepo(url)
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

function currentBranch(cwd: string): string | null {
  try {
    return (
      execSync('git branch --show-current', {
        cwd,
        timeout: 2000,
        stdio: 'pipe',
      })
        .toString()
        .trim() || null
    )
  } catch {
    return null // Detached HEAD or not a git repo
  }
}

/** The repo's name, and the remote it came from — set only when the name did come from the remote. */
function nameRepo(
  root: string,
  nameOverride: string | null,
  qualifyRepoName: boolean
): Pick<RepoContext, 'repoName' | 'remote'> {
  if (nameOverride !== null) return { repoName: nameOverride, remote: null }
  const remote = remoteOf(root)
  if (remote) return { repoName: formatRepoName(remote, qualifyRepoName), remote }
  return { repoName: nameFromPackageJson(root) ?? path.basename(root), remote: null }
}

/**
 * The repo at `cwd`, named the way the config says: the `projects.<cwd>` override, else the `origin` remote in the
 * `git.qualifyRepoName` form, else package.json or the folder. Everything that stores or looks up a repo name uses
 * this, so shell, IDE, notes and `context` always agree.
 */
export function getRepoContext(cwd: string, config: RepoNamingConfig): RepoContext {
  let root: string
  try {
    root = execSync('git rev-parse --show-toplevel', {
      cwd,
      timeout: 2000,
      stdio: 'pipe',
    })
      .toString()
      .trim()
  } catch {
    return NOT_A_REPO
  }
  const naming = nameRepo(root, config.projects?.[cwd] ?? null, config.git.qualifyRepoName)
  return { ...naming, branch: currentBranch(cwd), root }
}
