// What makes two events the same project, whatever the repo is called. Pure: shared by capture and the backfill job.

/** `remote`: keyed by the canonical `origin` remote. `local`: no remote, keyed by the git folder. `name`: only a
 * stored name was left to go on (a backfilled event whose folder is gone). */
export type ProjectKind = 'remote' | 'local' | 'name'

export interface ProjectIdentity {
  identity: string
  kind: ProjectKind
}

const SCHEME_URL = /^([a-z][a-z0-9+.-]*):\/\/(.*)$/i
// `user@host:path`, git's scp-like form. The host can't hold a `/`, so a local path never matches
const SCP_LIKE = /^(?:[^@/]+@)?([^:/]+):(.+)$/

function hostAndPath(url: string): { host: string; path: string } | null {
  const schemeMatch = SCHEME_URL.exec(url)
  if (schemeMatch) {
    if (schemeMatch[1].toLowerCase() === 'file') return null
    const rest = schemeMatch[2].replace(/^[^@/]*@/, '')
    const slash = rest.indexOf('/')
    if (slash <= 0) return null
    return { host: rest.slice(0, slash).replace(/:\d*$/, ''), path: rest.slice(slash + 1) }
  }
  const scpMatch = SCP_LIKE.exec(url)
  return scpMatch ? { host: scpMatch[1], path: scpMatch[2] } : null
}

/**
 * The remote URL with any user name and password or token removed (`https://user:token@host/…` → `https://host/…`),
 * so nothing stored can hold a credential. The scp-like form (`git@host:path`) can't carry one and is kept as is.
 */
export function withoutCredentials(url: string): string {
  const schemeMatch = SCHEME_URL.exec(url.trim())
  if (!schemeMatch) return url.trim()
  const [, scheme, rest] = schemeMatch
  const slash = rest.indexOf('/')
  const authority = slash === -1 ? rest : rest.slice(0, slash)
  const host = authority.slice(authority.lastIndexOf('@') + 1)
  return `${scheme}://${host}${slash === -1 ? '' : rest.slice(slash)}`
}

/**
 * `host/owner/repo` for any form of the same remote — SSH, scp-like, HTTPS, `git://` — with the user, port and `.git`
 * dropped and every group kept (`gitlab.com/group/sub/repo`). Lower-cased: hosts and the common forges ignore case.
 * Null for a remote with no host, such as a local path.
 */
export function canonicalRemote(url: string): string | null {
  const parts = hostAndPath(url.trim())
  if (!parts) return null
  const repoPath = parts.path
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '')
  if (!parts.host || !repoPath) return null
  return `${parts.host}/${repoPath}`.toLowerCase()
}

/** The project a repo belongs to: its remote when it has one, else its git folder, which all its worktrees share. */
export function projectIdentity(repo: { remoteUrl: string | null; commonDir: string | null }): ProjectIdentity | null {
  const remote = repo.remoteUrl === null ? null : canonicalRemote(repo.remoteUrl)
  if (remote !== null) return { identity: `remote:${remote}`, kind: 'remote' }
  if (repo.commonDir !== null) return { identity: `local:${repo.commonDir}`, kind: 'local' }
  return null
}

/** The project for a stored name alone, used only when nothing else is left to go on. */
export function nameIdentity(name: string): ProjectIdentity {
  return { identity: `name:${name.toLowerCase()}`, kind: 'name' }
}
