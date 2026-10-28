import { execFileSync } from 'child_process'
import path from 'path'

const GIT_TIMEOUT_MS = 3000
// Commands are captured when they finish, so a `git commit` that opens a session is stamped after
// its committer time — by however long the commit hooks ran. A commit closing a session can land
// just after its event.
export const WINDOW_LEAD_MS = 120_000
export const WINDOW_TRAIL_MS = 60_000
// How far back to look when checking who made a captured commit (pulled commits can be old)
const AUTHORSHIP_HISTORY_DEPTH = 500

export interface GitCommit {
  hash: string
  subject: string
  /** When it was committed (ISO 8601, committer date) — to place it on the session's branch timeline */
  committedAt: string
}

interface CommitWindow {
  repoRoot: string
  since: string
  until: string
  /** Only commits committed by this email (case-insensitive); all commits when null. */
  author: string | null
  /** Only commits that changed this file */
  filePath?: string
  /** This call's git timeout (default GIT_TIMEOUT_MS) — `getFileCommits` passes what's left of its budget */
  timeoutMs?: number
  /** Look on every local branch, not just HEAD — a commit made on `feat/x` still counts after you're back on `main` */
  allBranches?: boolean
}

/**
 * Runs git without a shell. Returns trimmed stdout, or null on any failure (no git, not a repo, timeout).
 * `timeoutMs` must be at least 1: Node treats a timeout of 0 as no timeout at all.
 */
function runGit(cwd: string, args: string[], timeoutMs = GIT_TIMEOUT_MS): string | null {
  try {
    return execFileSync('git', args, { cwd, timeout: timeoutMs, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

/** `timeoutMs`: this call's git timeout (default GIT_TIMEOUT_MS). */
export function getRepoRoot(cwd: string, timeoutMs?: number): string | null {
  return runGit(cwd, ['rev-parse', '--show-toplevel'], timeoutMs) || null
}

/** `timeoutMs`: this call's git timeout (default GIT_TIMEOUT_MS). */
export function getUserEmail(repoRoot: string, timeoutMs?: number): string | null {
  return runGit(repoRoot, ['config', 'user.email'], timeoutMs) || null
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
export function getCommitsInWindow(window: CommitWindow): GitCommit[] {
  return findCommitsInWindow(window) ?? []
}

/** Like `getCommitsInWindow`, but null when git couldn't answer (missing, not a repo, timed out), not just found none. */
export function findCommitsInWindow({
  repoRoot,
  since,
  until,
  author,
  filePath,
  timeoutMs,
  allBranches = false,
}: CommitWindow): GitCommit[] | null {
  const shiftedBy = (iso: string, milliseconds: number): string =>
    new Date(new Date(iso).getTime() + milliseconds).toISOString()
  const output = runGit(
    repoRoot,
    [
      'log',
      `--since=${shiftedBy(since, -WINDOW_LEAD_MS)}`,
      `--until=${shiftedBy(until, WINDOW_TRAIL_MS)}`,
      '--format=%h%x09%ce%x09%cI%x09%s',
      '--reverse',
      ...(allBranches ? ['--branches'] : []),
      ...(filePath ? ['--', filePath] : []),
    ],
    timeoutMs
  )
  if (output === null) return null
  if (output === '') return []

  const wantedAuthor = author?.toLowerCase() ?? null
  return output.split('\n').flatMap((line) => {
    // The subject goes last, since only it can contain a tab
    const [hash, email, committedAt, ...subjectParts] = line.split('\t')
    const subject = subjectParts.join('\t')
    if (!hash || !committedAt || !subject) return []
    if (wantedAuthor && email?.toLowerCase() !== wantedAuthor) return []
    return [{ hash, subject, committedAt }]
  })
}

export interface FileCommitsOptions {
  /** The file, with symlinks resolved — git reports the resolved repo root */
  filePath: string
  /** The session window */
  since: string
  until: string
  /** All of the git calls together get at most this long */
  budgetMs: number
  /** The clock, for tests */
  now?: () => number
}

/** The repo a file is in, and the user's commits in a session window that changed it. */
export interface FileCommits {
  repoRoot: string | null
  commits: GitCommit[]
}

/**
 * The commits in a session window that changed `filePath`, made by the repo's configured user. All three git calls
 * share one `budgetMs` deadline — `context --file` answers the VS Code extension, which gives up after 5 s — and
 * whatever is left when it runs out is skipped, giving no commits rather than a late answer. Pass a resolved path:
 * git reports the resolved repo root.
 */
export function getFileCommits(options: FileCommitsOptions): FileCommits {
  const now = options.now ?? Date.now
  const deadline = now() + options.budgetMs
  // Read once per git call and passed on as is, so a clock tick can't turn a checked 1 ms into a timeout of 0
  const timeLeft = (): number | null => {
    const milliseconds = deadline - now()
    return milliseconds >= 1 ? milliseconds : null
  }

  const rootTimeout = timeLeft()
  if (rootTimeout === null) return { repoRoot: null, commits: [] }
  const repoRoot = getRepoRoot(path.dirname(options.filePath), rootTimeout)
  if (!repoRoot) return { repoRoot: null, commits: [] }

  const emailTimeout = timeLeft()
  if (emailTimeout === null) return { repoRoot, commits: [] }
  const author = getUserEmail(repoRoot, emailTimeout)

  const logTimeout = timeLeft()
  if (logTimeout === null) return { repoRoot, commits: [] }
  const commits = getCommitsInWindow({
    repoRoot,
    since: options.since,
    until: options.until,
    author,
    filePath: options.filePath,
    timeoutMs: logTimeout,
  })
  return { repoRoot, commits }
}
