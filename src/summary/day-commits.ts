// The day's commits from git for the sessions `summary` and `export` render. One `git log` per repo covers all of
// its sessions, and every git call shares one budget, so a slow repo can't hold the summary up.
import { findCommitsInWindow, getRepoRoot, getUserEmail } from './git-commits'
import { repoCwd } from './payload'
import { assignCommitsToSessions } from './story-commits'
import type { GitCommit } from './git-commits'
import type { Session } from '../sessions/detector'

export const DAY_GIT_BUDGET_MS = 3000

export interface DayCommitOptions {
  /** All of the run's git calls together get at most this long */
  budgetMs: number
  /** The clock, for tests */
  now?: () => number
}

interface RepoSessions {
  repoRoot: string
  indexes: number[]
}

/** Groups the sessions by the repo they ran in; sessions outside a repo, or past the budget, aren't looked up. */
function groupByRepo(sessions: Session[], timeLeft: () => number | null): RepoSessions[] {
  const rootOfCwd = new Map<string, string | null>()
  const byRoot = new Map<string, number[]>()
  for (const [index, session] of sessions.entries()) {
    const cwd = repoCwd(session)
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

/** One `git log` for the repo, from its sessions' earliest start to their latest end — null past the budget, or if git can't answer. */
function repoCommits(repo: RepoSessions, sessions: Session[], timeLeft: () => number | null): GitCommit[] | null {
  const emailTimeout = timeLeft()
  if (emailTimeout === null) return null
  const author = getUserEmail(repo.repoRoot, emailTimeout)
  // Without your committer email git can't tell your commits from pulled ones, so the story keeps to captured ones
  if (author === null) return null
  const logTimeout = timeLeft()
  if (logTimeout === null) return null
  const repoSessions = repo.indexes.map((index) => sessions[index])
  const byTime = (first: string, second: string): number => Date.parse(first) - Date.parse(second)
  const startTimes = repoSessions.map((session) => session.startedAt).sort(byTime)
  const endTimes = repoSessions.map((session) => session.endedAt).sort(byTime)
  return findCommitsInWindow({
    repoRoot: repo.repoRoot,
    since: startTimes[0],
    until: endTimes[endTimes.length - 1],
    author,
    timeoutMs: logTimeout,
    allBranches: true,
  })
}

/**
 * Each session's commits from `git log`, by your committer email — or null for a session git wasn't asked about
 * (outside a repo, git missing or slow, the budget spent). The story then tells the commits Workscribe captured.
 */
export function lookupDayCommits(sessions: Session[], options: DayCommitOptions): (GitCommit[] | null)[] {
  const now = options.now ?? Date.now
  const deadline = now() + options.budgetMs
  // Read once per git call and passed on as is, so a clock tick can't turn a checked 1 ms into a timeout of 0
  const timeLeft = (): number | null => {
    const milliseconds = deadline - now()
    return milliseconds >= 1 ? milliseconds : null
  }

  const perSession: (GitCommit[] | null)[] = sessions.map(() => null)
  for (const repo of groupByRepo(sessions, timeLeft)) {
    const commits = repoCommits(repo, sessions, timeLeft)
    if (commits === null) continue
    const windows = repo.indexes.map((index) => sessions[index])
    const assigned = assignCommitsToSessions(windows, commits)
    for (const [position, index] of repo.indexes.entries()) perSession[index] = assigned[position]
  }
  return perSession
}
