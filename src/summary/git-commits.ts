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

/** What a commit changed, from `git show --numstat`: files, and lines added and removed (a binary file adds none). */
export interface CommitSize {
  files: number
  added: number
  removed: number
}

export interface GitCommit {
  hash: string
  subject: string
  /** When it was committed (ISO 8601, committer date) — to place it on the session's branch timeline */
  committedAt: string
  /** What it changed; only when `getCommitSizes` was asked, and never for a merge or a commit with no changed file */
  size?: CommitSize
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

/**
 * The repository `cwd` is in, spelled the way `cwd` is — git's own `--show-toplevel` answers with symlinks resolved
 * (`/private/tmp` for `/tmp`), which wouldn't match the folders events were captured in. Null outside a repository, for
 * a folder that is gone, or when git fails.
 */
export function getRepoRootOf(cwd: string, timeoutMs?: number): string | null {
  const upToRoot = runGit(cwd, ['rev-parse', '--show-cdup'], timeoutMs)
  return upToRoot === null ? null : path.resolve(cwd, upToRoot === '' ? '.' : upToRoot)
}

// `git check-ignore` exits with 1 when it looked and none of the paths is ignored
const NONE_IGNORED_STATUS = 1

/** Whether a process failed by exiting with this status (Node puts it on the error it throws). */
function hasExitStatus(error: unknown, status: number): boolean {
  return typeof error === 'object' && error !== null && 'status' in error && error.status === status
}

/**
 * The paths among these that git ignores in the repository, or null when git couldn't say (no git, a folder that is
 * gone, a timeout). The paths go in on stdin, NUL-separated, never in arguments: a path can't be read as an option, and
 * a long list can't overflow the command line.
 */
export function getIgnoredPaths(repoRoot: string, paths: string[], timeoutMs = GIT_TIMEOUT_MS): Set<string> | null {
  if (paths.length === 0) return new Set()
  try {
    const output = execFileSync('git', ['check-ignore', '-z', '--stdin'], {
      cwd: repoRoot,
      timeout: timeoutMs,
      input: paths.join('\0'),
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    return new Set(
      output
        .toString()
        .split('\0')
        .filter((ignored) => ignored !== '')
    )
  } catch (error) {
    return hasExitStatus(error, NONE_IGNORED_STATUS) ? new Set() : null
  }
}

const COMMIT_MARKER = '\u0001'
const HASH_PATTERN = /^[0-9a-f]{4,64}$/i
const NUMSTAT_LINE = /^(\d+|-)\t(\d+|-)\t/
// A whole day's commits fit in a few batches; the `git show` output of a very large commit needs room
const SIZE_BATCH = 100
const SIZE_MAX_BUFFER = 16 * 1024 * 1024
const MERGE_PARENTS = 2
const MIN_TIMEOUT_MS = 1

function lineCount(count: string): number {
  return count === '-' ? 0 : Number(count)
}

/** One commit of a `git show --numstat` output: its hash, whether it has several parents, and its numstat lines. */
interface ShownCommit {
  hash: string
  isMerge: boolean
  numstat: string[]
}

/** The output split at the marker line that starts each commit. */
function shownCommitsOf(output: string): ShownCommit[] {
  const commits: ShownCommit[] = []
  for (const line of output.split('\n')) {
    if (line.startsWith(COMMIT_MARKER)) {
      const [hash, parents = ''] = line.slice(COMMIT_MARKER.length).split('\t')
      commits.push({ hash, isMerge: parents.split(' ').length >= MERGE_PARENTS, numstat: [] })
    } else if (NUMSTAT_LINE.test(line)) {
      commits.at(-1)?.numstat.push(line)
    }
  }
  return commits
}

/** The files and lines of a commit's numstat lines: a rename is one line, and `-` (a binary file) adds no lines. */
function sizeOfNumstat(numstat: string[]): CommitSize {
  return numstat.reduce<CommitSize>(
    (size, line) => {
      const [added, removed] = line.split('\t')
      return { files: size.files + 1, added: size.added + lineCount(added), removed: size.removed + lineCount(removed) }
    },
    { files: 0, added: 0, removed: 0 }
  )
}

/** One `git show --numstat` output as sizes by hash. A merge, or a commit that changed no file, has none. */
function parseSizes(output: string): Map<string, CommitSize> {
  const shown = shownCommitsOf(output).filter((commit) => !commit.isMerge && commit.numstat.length > 0)
  return new Map(shown.map((commit) => [commit.hash, sizeOfNumstat(commit.numstat)]))
}

/**
 * The output of `git show --numstat` for these hashes, or null when git couldn't answer within `timeoutMs`. The hashes
 * end with `--`, so a short hash that is also a file or branch name is still read as a commit.
 */
function showNumstat(repoRoot: string, hashes: string[], timeoutMs: number): string | null {
  try {
    return execFileSync('git', ['show', '--numstat', `--format=${COMMIT_MARKER}%h%x09%P`, ...hashes, '--'], {
      cwd: repoRoot,
      timeout: timeoutMs,
      maxBuffer: SIZE_MAX_BUFFER,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toString()
  } catch {
    return null
  }
}

/**
 * How much each of these commits changed, by hash: its files and lines, a rename as one file and a binary file as a file
 * with no lines. A merge is left out — against its first parent it would be everything merged in — and so is a commit
 * that changed no file. Everything must fit in `timeoutMs`: batches that don't are left unsized, and null means git
 * answered nothing. Only hashes are passed to git, and as arguments, never through a shell.
 */
export function getCommitSizes(
  repoRoot: string,
  hashes: string[],
  timeoutMs = GIT_TIMEOUT_MS
): Map<string, CommitSize> | null {
  const valid = hashes.filter((hash) => HASH_PATTERN.test(hash))
  const deadline = Date.now() + timeoutMs
  const sizes = new Map<string, CommitSize>()
  for (let start = 0; start < valid.length; start += SIZE_BATCH) {
    const timeLeft = Math.ceil(deadline - Date.now())
    if (timeLeft < MIN_TIMEOUT_MS) break
    const output = showNumstat(repoRoot, valid.slice(start, start + SIZE_BATCH), timeLeft)
    if (output === null) return sizes.size > 0 ? sizes : null
    for (const [hash, size] of parseSizes(output)) sizes.set(hash, size)
  }
  return sizes
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
