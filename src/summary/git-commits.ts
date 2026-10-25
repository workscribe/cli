import { execFileSync } from 'child_process'

const GIT_TIMEOUT_MS = 3000
// Commands are captured when they finish, so a `git commit` that opens a session is stamped after
// its committer time — by however long the commit hooks ran. A commit closing a session can land
// just after its event.
const WINDOW_LEAD_MS = 120_000
const WINDOW_TRAIL_MS = 60_000
// How far back to look when checking who made a captured commit (pulled commits can be old)
const AUTHORSHIP_HISTORY_DEPTH = 500

export interface GitCommit {
  hash: string
  subject: string
}

interface CommitWindow {
  repoRoot: string
  since: string
  until: string
  /** Only commits committed by this email (case-insensitive); all commits when null. */
  author: string | null
}

/** Runs git without a shell. Returns trimmed stdout, or null on any failure (no git, not a repo, timeout). */
function runGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd, timeout: GIT_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

export function getRepoRoot(cwd: string): string | null {
  return runGit(cwd, ['rev-parse', '--show-toplevel']) || null
}

export function getUserEmail(repoRoot: string): string | null {
  return runGit(repoRoot, ['config', 'user.email']) || null
}

/**
 * Subjects in the last AUTHORSHIP_HISTORY_DEPTH commits on HEAD that only other people committed.
 * Empty without an author to compare against, or when git fails.
 */
export function getOthersSubjects(repoRoot: string, author: string | null): string[] {
  if (!author) return []
  const output = runGit(repoRoot, ['log', `-n${AUTHORSHIP_HISTORY_DEPTH}`, '--format=%ce%x09%s'])
  if (!output) return []

  const wantedAuthor = author.toLowerCase()
  const mine = new Set<string>()
  const theirs = new Set<string>()
  for (const line of output.split('\n')) {
    const [email, ...subjectParts] = line.split('\t')
    const subject = subjectParts.join('\t')
    if (!subject) continue
    if (email?.toLowerCase() === wantedAuthor) mine.add(subject)
    else theirs.add(subject)
  }
  return [...theirs].filter((subject) => !mine.has(subject))
}

/**
 * Commits made during a session, oldest first. Window and author both use the *committer* (who made
 * the commit then — including cherry-picks of someone else's work) and only commits reachable from
 * HEAD are seen. `--since` also stops at the first commit older than the window, so after a rebase
 * that leaves dates out of order a few in-window commits can be missed. Captured commit messages
 * cover what this misses.
 */
export function getCommitsInWindow({ repoRoot, since, until, author }: CommitWindow): GitCommit[] {
  const shiftedBy = (iso: string, milliseconds: number): string =>
    new Date(new Date(iso).getTime() + milliseconds).toISOString()
  const output = runGit(repoRoot, [
    'log',
    `--since=${shiftedBy(since, -WINDOW_LEAD_MS)}`,
    `--until=${shiftedBy(until, WINDOW_TRAIL_MS)}`,
    '--format=%h%x09%ce%x09%s',
    '--reverse',
  ])
  if (!output) return []

  const wantedAuthor = author?.toLowerCase() ?? null
  return output.split('\n').flatMap((line) => {
    const [hash, email, ...subjectParts] = line.split('\t')
    const subject = subjectParts.join('\t')
    if (!hash || !subject) return []
    if (wantedAuthor && email?.toLowerCase() !== wantedAuthor) return []
    return [{ hash, subject }]
  })
}
