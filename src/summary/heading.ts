import { formatDuration } from '../utils/format'
import type { SessionPayload } from '../ai/types'

/** Shown when a session has neither a repo nor any events to name it by. */
export const UNKNOWN_LOCATION = 'unknown'

type HeadingFields = Pick<SessionPayload, 'project' | 'branch' | 'durationMinutes'> &
  Partial<Pick<SessionPayload, 'branches'>>

/** Every branch the session touched, in the order first seen — or its one branch when that's all that's known. */
function headingBranches(session: HeadingFields): string[] {
  if (session.branches && session.branches.length > 0) return session.branches
  return session.branch ? [session.branch] : []
}

/** `project (feat/auth, main) — duration`, as used in headings and the --verbose event listing. */
export function formatSessionLabel(session: HeadingFields): string {
  const branches = headingBranches(session)
  const branchList = branches.length > 0 ? ` (${branches.join(', ')})` : ''
  return `${session.project ?? UNKNOWN_LOCATION}${branchList} — ${formatDuration(session.durationMinutes)}`
}

/** The `## project (branches) — duration` line every session summary starts with. */
export function formatSessionHeading(session: HeadingFields): string {
  return `## ${formatSessionLabel(session)}`
}
