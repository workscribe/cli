// Which commits a session's story tells, and the branch each belongs to. Pure: the git lookups happen elsewhere.
import { collectCapturedCommits, isFailedCommand, isSameCommit, mergeCommits } from './commits'
import { parseMetadata } from './event-metadata'
import { WINDOW_LEAD_MS, WINDOW_TRAIL_MS } from './git-commits'
import type { EventRow } from '../db/types'
import type { CommitSize, GitCommit } from './git-commits'

/** A commit as the story shows it: under the branch it was made on. */
export interface StoryCommit {
  subject: string
  hash: string | null
  committedAt: string | null
  branch: string | null
  /** What git says it changed, for a commit git returned and could size */
  size?: CommitSize
}

type TimedBranch = Pick<EventRow, 'branch' | 'captured_at'>

/**
 * The branch the session was on at `time`: that of its latest event at or before it — or, for a time before every
 * event, the first event's. `git log` doesn't record which branch a commit was made on, so the timeline decides.
 */
export function branchAt(events: TimedBranch[], time: string): string | null {
  const moment = Date.parse(time)
  const onBranch = events.filter((event) => event.branch !== null)
  const atOrBefore = onBranch.filter((event) => Date.parse(event.captured_at) <= moment)
  return (atOrBefore.at(-1) ?? onBranch[0])?.branch ?? null
}

/**
 * The `git commit` capture that recorded this git commit: same subject, captured when it finished — at or after its
 * whole-second commit time, within the hook allowance. Its branch is the one the commit was made on, even when the
 * same command switched branch first (`git switch -c feat/x && git commit -m …`), which the timeline can't see.
 */
function captureOf(events: EventRow[], commit: GitCommit): EventRow | undefined {
  const committed = Date.parse(commit.committedAt)
  return events
    .filter((event) => {
      if (event.category !== 'shipping' || isFailedCommand(event)) return false
      const message = parseMetadata(event.metadata).message
      if (typeof message !== 'string' || !isSameCommit(message, commit.subject)) return false
      const captured = Date.parse(event.captured_at)
      return captured >= committed && captured <= committed + WINDOW_LEAD_MS
    })
    .sort((first, second) => Date.parse(first.captured_at) - Date.parse(second.captured_at))[0]
}

/**
 * The session's commits — its git commits, then captured ones git didn't return — each with its branch:
 * - a git commit goes under the branch of its own `git commit` capture, or else by its time on the timeline. An AI
 *   session's list can't place it (that's the branch the session ended on), nor can a repeated subject's first
 *   capture (`wip` on two branches).
 * - a captured-only commit keeps the branch it was captured on.
 *
 * `gitCommits` is null when git wasn't asked. When it was, an AI session's commit that git doesn't confirm is left
 * out: the session lists every commit that reached HEAD, pulled ones too, while git's window holds only yours.
 */
export function storyCommitsOf(events: EventRow[], gitCommits: GitCommit[] | null): StoryCommit[] {
  const confirmedByGit = (subject: string): boolean =>
    gitCommits?.some((commit) => isSameCommit(subject, commit.subject)) ?? false
  const captured = collectCapturedCommits(events).filter(
    (commit) => gitCommits === null || commit.committedAt !== null || confirmedByGit(commit.subject)
  )
  const capturedBranches = new Map(captured.map((commit) => [commit.subject, commit.branch]))
  const gitBranchOf = (commit: GitCommit): string | null =>
    captureOf(events, commit)?.branch ?? branchAt(events, commit.committedAt)
  const gitCommitsByHash = new Map((gitCommits ?? []).map((commit) => [commit.hash, commit]))
  return mergeCommits(captured, gitCommits ?? []).map(({ hash, subject, committedAt, source }) => {
    const gitCommit = source === 'git' && hash !== null ? gitCommitsByHash.get(hash) : undefined
    return {
      hash,
      subject,
      committedAt,
      branch: gitCommit ? gitBranchOf(gitCommit) : (capturedBranches.get(subject) ?? null),
      ...(gitCommit?.size === undefined ? {} : { size: gitCommit.size }),
    }
  })
}

/** A session's time span, as `getCommitsInWindow` widens it. */
export interface SessionWindow {
  startedAt: string
  endedAt: string
}

/**
 * Hands each commit of a repo's day to the first session whose window (widened like `getCommitsInWindow`'s)
 * contains its time, so one lookup per repo serves all its sessions and no commit is told twice.
 */
export function assignCommitsToSessions(windows: SessionWindow[], commits: GitCommit[]): GitCommit[][] {
  const assigned: GitCommit[][] = windows.map(() => [])
  for (const commit of commits) {
    const moment = Date.parse(commit.committedAt)
    const index = windows.findIndex(
      (window) =>
        moment >= Date.parse(window.startedAt) - WINDOW_LEAD_MS &&
        moment <= Date.parse(window.endedAt) + WINDOW_TRAIL_MS
    )
    if (index !== -1) assigned[index].push(commit)
  }
  return assigned
}
