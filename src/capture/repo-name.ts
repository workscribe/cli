// How a repo's `origin` remote becomes a repo name, in both forms `git.qualifyRepoName` chooses between. Pure.

/** The owner and repo parsed from an `origin` remote URL. */
export interface RemoteRepo {
  owner: string
  repo: string
}

// Handles SSH (git@host:owner/repo.git), HTTPS (https://host/owner/repo.git),
// and bare git:// / ssh:// forms uniformly by normalizing the SSH scp-like
// syntax's first ':' to '/' (but not the '://' in URLs with a real scheme),
// then splitting on '/'.
export function parseOwnerAndRepo(url: string): RemoteRepo | null {
  const normalized = url.trim().replace(/^[^/]+:(?!\/\/)/, (match) => match.replace(':', '/'))
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length < 2) return null
  const repo = segments[segments.length - 1].replace(/\.git$/, '')
  const owner = segments[segments.length - 2]
  return owner && repo ? { owner, repo } : null
}

/** `owner/repo` when qualified, bare `repo` otherwise. */
export function formatRepoName(remote: RemoteRepo, qualify: boolean): string {
  return qualify ? `${remote.owner}/${remote.repo}` : remote.repo
}
