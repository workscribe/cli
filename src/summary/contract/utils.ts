import { eventRowToPayload } from '../payload'
import { buildExcludedSet } from '../exclusions'
import type { EventRow } from '../../db/types'
import type { GitCommit } from '../git-commits'
import type { CommitJson } from './types'

/** Events the contract reports: the AI engines' exclusions apply, and notes go to `notes` instead. */
export function contractEvents(rows: EventRow[], includeCategories: string[]): EventRow[] {
  const excluded = buildExcludedSet(includeCategories)
  return rows.filter((row) => row.category !== 'note' && !excluded.has(row.category))
}

export function collectNotes(rows: EventRow[]): string[] {
  return rows.flatMap((row) => {
    if (row.category !== 'note') return []
    const { text } = eventRowToPayload(row).metadata
    return typeof text === 'string' && text !== '' ? [text] : []
  })
}

function isFailedCommand(row: EventRow): boolean {
  return row.exit_code !== null && row.exit_code !== 0
}

/** A commit Workscribe captured itself, and when — null when only the subject is known. */
export interface CapturedCommit {
  subject: string
  committedAt: string | null
}

/**
 * Commits Workscribe captured itself: `git commit -m` messages, at the time the commit finished, and AI-session
 * commits (subjects only — the session records which commits reached HEAD, not when). A `git commit` that failed
 * (rejected by a hook, nothing staged) made no commit, so it is skipped. A repeated subject keeps its first place,
 * and the first time any capture of it recorded.
 */
export function collectCapturedCommits(rows: EventRow[]): CapturedCommit[] {
  const commits = rows.flatMap((row): CapturedCommit[] => {
    const { metadata } = eventRowToPayload(row)
    if (row.category === 'shipping' && typeof metadata.message === 'string' && !isFailedCommand(row)) {
      return [{ subject: metadata.message, committedAt: row.captured_at }]
    }
    if (row.category === 'ai_session' && Array.isArray(metadata.commits)) {
      return metadata.commits
        .filter((subject): subject is string => typeof subject === 'string')
        .map((subject) => ({ subject, committedAt: null }))
    }
    return []
  })
  const bySubject = new Map<string, CapturedCommit>()
  for (const commit of commits) {
    if (commit.subject === '') continue
    const earlier = bySubject.get(commit.subject)
    // An AI session recorded before its `git commit -m` mustn't hide the time that capture has
    bySubject.set(
      commit.subject,
      earlier ? { ...earlier, committedAt: earlier.committedAt ?? commit.committedAt } : commit
    )
  }
  return [...bySubject.values()]
}

/**
 * Whether a captured subject is this git commit. Besides an exact match, it tolerates the two ways
 * events captured before the `-m` parsing fix were cut wrong — and only those, so a short `fix`
 * never matches `fix: something else`:
 * - stopped at an inner quote: `fix: don` for `fix: don't redirect`
 * - ran on into flags: `wip --no-verify` for `wip`
 */
export function isSameCommit(captured: string, gitSubject: string): boolean {
  if (captured === gitSubject) return true
  if (gitSubject.startsWith(captured)) return /^['"]/.test(gitSubject.slice(captured.length))
  if (captured.startsWith(gitSubject)) return /^\s+-/.test(captured.slice(gitSubject.length))
  return false
}

/**
 * Git commits first, oldest first and each listed even if subjects repeat (they are distinct commits),
 * then captured subjects git didn't return — amended, rebased or on another branch — with no hash.
 * Captured subjects git attributes only to other people are dropped: an AI session records every
 * commit that reached HEAD, including ones pulled or rebased in.
 */
export function mergeCommits(
  captured: CapturedCommit[],
  fromGit: GitCommit[],
  othersSubjects: string[] = []
): CommitJson[] {
  const others = new Set(othersSubjects)
  const gitCommits: CommitJson[] = fromGit.map(({ hash, subject, committedAt }) => ({
    hash,
    subject,
    committedAt,
    source: 'git',
  }))
  const capturedOnly: CommitJson[] = captured
    .filter(({ subject }) => !others.has(subject))
    .filter(({ subject }) => !fromGit.some((commit) => isSameCommit(subject, commit.subject)))
    .map(({ subject, committedAt }) => ({ hash: null, subject, committedAt, source: 'captured' }))
  return [...gitCommits, ...capturedOnly]
}
