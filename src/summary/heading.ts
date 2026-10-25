import { formatDuration } from '../utils/format'
import type { SessionPayload } from '../ai/types'

/** Shown when a session has neither a repo nor any events to name it by. */
export const UNKNOWN_LOCATION = 'unknown'

type HeadingFields = Pick<SessionPayload, 'project' | 'branch' | 'durationMinutes'>

/** `project (branch) — duration`, as used in headings and the --verbose event listing. */
export function formatSessionLabel(session: HeadingFields): string {
  const branch = session.branch ? ` (${session.branch})` : ''
  return `${session.project ?? UNKNOWN_LOCATION}${branch} — ${formatDuration(session.durationMinutes)}`
}

/** The `## project (branch) — duration` line every session summary starts with. */
export function formatSessionHeading(session: HeadingFields): string {
  return `## ${formatSessionLabel(session)}`
}
