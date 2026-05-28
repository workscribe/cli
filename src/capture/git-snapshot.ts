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
