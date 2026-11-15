import { execSync } from 'child_process'

/**
 * Returns commit subject lines for all commits made between `sha` and HEAD.
 * Returns an empty array if sha is empty, HEAD hasn't moved, or git fails.
 */
export function getCommitsSince(sha: string, cwd: string): string[] {
  if (!sha) return []
  try {
    const out = execSync(`git log ${sha}..HEAD --format=%s`, { cwd, timeout: 3000 }).toString().trim()
    return out ? out.split('\n').filter(Boolean) : []
  } catch {
    return []
  }
}

/** The subject of the commit `HEAD` points to, or null when git can't say (no repo, no commits, too slow). */
export function latestCommitSubject(cwd: string): string | null {
  try {
    const subject = execSync('git log -1 --format=%s', { cwd, timeout: 3000 }).toString().trim()
    return subject === '' ? null : subject
  } catch {
    return null
  }
}
