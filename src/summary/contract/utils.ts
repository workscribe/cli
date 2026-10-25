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

/**
 * Commit subjects Workscribe captured itself: `git commit -m` messages and AI-session commits.
 * A `git commit` that failed (rejected by a hook, nothing staged) made no commit, so it is skipped.
 */
export function collectCapturedCommits(rows: EventRow[]): string[] {
  const subjects = rows.flatMap((row) => {
    const { metadata } = eventRowToPayload(row)
    if (row.category === 'shipping' && typeof metadata.message === 'string' && !isFailedCommand(row)) {
      return [metadata.message]
    }
    if (row.category === 'ai_session' && Array.isArray(metadata.commits)) {
      return metadata.commits.filter((subject): subject is string => typeof subject === 'string')
    }
    return []
  })
  return [...new Set(subjects.filter((subject) => subject !== ''))]
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
export function mergeCommits(captured: string[], fromGit: GitCommit[], othersSubjects: string[] = []): CommitJson[] {
  const others = new Set(othersSubjects)
  const gitCommits: CommitJson[] = fromGit.map((commit) => ({ ...commit, source: 'git' }))
  const capturedOnly: CommitJson[] = captured
    .filter((subject) => !others.has(subject))
    .filter((subject) => !fromGit.some((commit) => isSameCommit(subject, commit.subject)))
    .map((subject) => ({ hash: null, subject, source: 'captured' }))
  return [...gitCommits, ...capturedOnly]
}
