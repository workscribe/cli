import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'
import type { WorkscribeConfig } from '../config'
import { formatRepoName, parseOwnerAndRepo, type RemoteRepo } from './repo-name'
import { projectIdentity, withoutCredentials, type ProjectIdentity } from './project-identity'

/** Everything known about the repo at a path — `root` and `remote` let `context` find the other name form too. */
export interface RepoContext {
  repoName: string | null
  branch: string | null
  root: string | null
  /** The `origin` remote, set only when `repoName` came from it (not an override, package.json or the folder) */
  remote: RemoteRepo | null
  /** The project the repo belongs to, however it's named — null outside a repo */
  project: ProjectIdentity | null
}

/** What git says about a folder: gone, not in a repo, or the repo's root, git folder and `origin` remote. */
export type DirectoryProbe =
  | { outcome: 'missing' | 'not-a-repo' }
  | { outcome: 'repo'; root: string; commonDir: string | null; remoteUrl: string | null }

/** The settings that decide what a repo is called. */
export type RepoNamingConfig = Pick<WorkscribeConfig, 'projects' | 'git'>

const NOT_A_REPO: RepoContext = { repoName: null, branch: null, root: null, remote: null, project: null }

function gitOutput(command: string, cwd: string): string | null {
  try {
    return execSync(command, { cwd, timeout: 2000, stdio: 'pipe' }).toString().trim() || null
  } catch {
    return null
  }
}

/** The `origin` remote, never with a credential in it — the backfill stores it */
function remoteUrlOf(root: string): string | null {
  const url = gitOutput('git remote get-url origin', root)
  return url === null ? null : withoutCredentials(url)
}

/** The git folder every worktree of the repo shares, resolved, so two paths to one repo give one answer. */
function commonDirOf(directory: string): string | null {
  const commonDir = gitOutput('git rev-parse --git-common-dir', directory)
  if (commonDir === null) return null
  const absolute = path.resolve(directory, commonDir)
  try {
    return fs.realpathSync(absolute)
  } catch {
    return absolute
  }
}

/** The repo's identity — the git folder is only asked for when there's no usable remote. */
function identityOf(directory: string, remoteUrl: string | null): ProjectIdentity | null {
  return (
    projectIdentity({ remoteUrl, commonDir: null }) ?? projectIdentity({ remoteUrl, commonDir: commonDirOf(directory) })
  )
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
function nameRepo(repo: {
  root: string
  nameOverride: string | null
  remoteUrl: string | null
  qualifyRepoName: boolean
}): Pick<RepoContext, 'repoName' | 'remote'> {
  const { root, nameOverride, remoteUrl, qualifyRepoName } = repo
  if (nameOverride !== null) return { repoName: nameOverride, remote: null }
  const remote = remoteUrl === null ? null : parseOwnerAndRepo(remoteUrl)
  if (remote) return { repoName: formatRepoName(remote, qualifyRepoName), remote }
  return { repoName: nameFromPackageJson(root) ?? path.basename(root), remote: null }
}

/**
 * The repo at `cwd`, named the way the config says: the `projects.<cwd>` override, else the `origin` remote in the
 * `git.qualifyRepoName` form, else package.json or the folder. Everything that stores or looks up a repo name uses
 * this, so shell, IDE, notes and `context` always agree.
 */
export function getRepoContext(cwd: string, config: RepoNamingConfig): RepoContext {
  const root = gitOutput('git rev-parse --show-toplevel', cwd)
  if (root === null) return NOT_A_REPO
  // Read even when an override names the repo: the name may come from config, the identity never does
  const remoteUrl = remoteUrlOf(root)
  const naming = nameRepo({
    root,
    nameOverride: config.projects?.[cwd] ?? null,
    remoteUrl,
    qualifyRepoName: config.git.qualifyRepoName,
  })
  return { ...naming, branch: currentBranch(cwd), root, project: identityOf(cwd, remoteUrl) }
}

/** What git says about a folder now — the backfill job asks once per folder and keeps the answer. */
export function probeDirectory(directory: string): DirectoryProbe {
  if (!fs.existsSync(directory)) return { outcome: 'missing' }
  // A bare repo or a path inside `.git` has no work tree, so it isn't a repo here — as for capture
  const root = gitOutput('git rev-parse --show-toplevel', directory)
  if (root === null) return { outcome: 'not-a-repo' }
  return { outcome: 'repo', root, commonDir: commonDirOf(directory), remoteUrl: remoteUrlOf(root) }
}
