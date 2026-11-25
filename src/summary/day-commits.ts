// The day's commits from git for the threads `summary` and `export` render. One `git log` per repo covers all of
// its threads, and every git call shares one budget, so a slow repo can't hold the summary up.
import { findCommitsInWindow, getCommitSizes, getRepoRoot, getUserEmail } from './git-commits'
import { assignCommitsToSessions } from './story-commits'
import type { GitCommit } from './git-commits'

export const DAY_GIT_BUDGET_MS = 3000
const SIZE_BUDGET_DIVISOR = 2

export interface DayCommitOptions {
  /** All of the run's git calls together get at most this long */
  budgetMs: number
  /** The clock, for tests */
  now?: () => number
}

/** A stretch of work to find commits for: a folder inside its repo (null outside one) and its time span. */
export interface CommitWindow {
  cwd: string | null
  startedAt: string
  endedAt: string
}

interface RepoWindows {
  repoRoot: string
  indexes: number[]
}

/** Groups the windows by the repo they ran in; windows outside a repo, or past the budget, aren't looked up. */
function groupByRepo(windows: CommitWindow[], timeLeft: () => number | null): RepoWindows[] {
  const rootOfCwd = new Map<string, string | null>()
  const byRoot = new Map<string, number[]>()
  for (const [index, { cwd }] of windows.entries()) {
    if (!cwd) continue
    if (!rootOfCwd.has(cwd)) {
      const timeout = timeLeft()
      if (timeout === null) break
      rootOfCwd.set(cwd, getRepoRoot(cwd, timeout))
    }
    const repoRoot = rootOfCwd.get(cwd)
    if (repoRoot) byRoot.set(repoRoot, [...(byRoot.get(repoRoot) ?? []), index])
  }
  return [...byRoot].map(([repoRoot, indexes]) => ({ repoRoot, indexes }))
}

/**
 * The commits with what each changed, from one more git call inside what is left of the budget. Without time, or when git
 * can't say, the commits are told as they were: a size is a detail, never a reason to lose a commit.
 */
function withSizes(commits: GitCommit[], repoRoot: string, timeLeft: () => number | null): GitCommit[] {
  if (commits.length === 0) return commits
  const timeout = timeLeft()
  if (timeout === null) return commits
  // At most half of what is left: a size is a detail, so a slow `git show` can't take the next repository's commits
  // with it
  const sizes = getCommitSizes(
    repoRoot,
    commits.map((commit) => commit.hash),
    Math.ceil(timeout / SIZE_BUDGET_DIVISOR)
  )
  if (sizes === null) return commits
  return commits.map((commit) => {
    const size = sizes.get(commit.hash)
    return size === undefined ? commit : { ...commit, size }
  })
}

/** One `git log` for the repo, from its windows' earliest start to their latest end — null past the budget, or if git can't answer. */
function repoCommits(repo: RepoWindows, windows: CommitWindow[], timeLeft: () => number | null): GitCommit[] | null {
  const emailTimeout = timeLeft()
  if (emailTimeout === null) return null
  const author = getUserEmail(repo.repoRoot, emailTimeout)
  // Without your committer email git can't tell your commits from pulled ones, so the story keeps to captured ones
  if (author === null) return null
  const logTimeout = timeLeft()
  if (logTimeout === null) return null
  const repoWindows = repo.indexes.map((index) => windows[index])
  const byTime = (first: string, second: string): number => Date.parse(first) - Date.parse(second)
  const startTimes = repoWindows.map((window) => window.startedAt).sort(byTime)
  const endTimes = repoWindows.map((window) => window.endedAt).sort(byTime)
  const commits = findCommitsInWindow({
    repoRoot: repo.repoRoot,
    since: startTimes[0],
    until: endTimes[endTimes.length - 1],
    author,
    timeoutMs: logTimeout,
    allBranches: true,
  })
  return commits === null ? null : withSizes(commits, repo.repoRoot, timeLeft)
}

/**
 * Each window's commits from `git log`, by your committer email — or null for a window git wasn't asked about
 * (outside a repo, git missing or slow, the budget spent). The story then tells the commits Workscribe captured.
 * Windows of one repo that overlap (two projects in one git root) share its commits: each goes to the first window,
 * in the order given, whose span holds it — `renderDay` passes threads in block order, so the one that started first.
 */
export function lookupDayCommits(windows: CommitWindow[], options: DayCommitOptions): (GitCommit[] | null)[] {
  const now = options.now ?? Date.now
  const deadline = now() + options.budgetMs
  // Read once per git call and passed on as is, so a clock tick can't turn a checked 1 ms into a timeout of 0
  const timeLeft = (): number | null => {
    const milliseconds = deadline - now()
    return milliseconds >= 1 ? milliseconds : null
  }

  const perWindow: (GitCommit[] | null)[] = windows.map(() => null)
  for (const repo of groupByRepo(windows, timeLeft)) {
    const commits = repoCommits(repo, windows, timeLeft)
    if (commits === null) continue
    const assigned = assignCommitsToSessions(
      repo.indexes.map((index) => windows[index]),
      commits
    )
    for (const [position, index] of repo.indexes.entries()) perWindow[index] = assigned[position]
  }
  return perWindow
}
