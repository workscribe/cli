import type { DaySummaryPayload } from './types'
import { formatDuration } from '../utils/format'

export const SYSTEM_PROMPT = `You are a technical writer generating a work summary for a software developer.

Rules:
- Write in past tense, professional tone
- Describe what was ACCOMPLISHED, not what commands were run
- Never write literal command names (e.g. do not write "ran npm install" — write "added HTTP client dependency")
- Never list commands literally
- Each bullet point should describe a meaningful unit of work
- Group related events into single bullet points
- If tests failed then passed, describe it as "resolved failing tests" not two separate events
- Return 3-6 bullet points per project section
- Do not pad or add filler sentences
- Output only the bullet points grouped under project headers using this exact format:

## <project-name> (<branch>) — <duration>

- bullet point one
- bullet point two

If there is no branch, omit the branch. If there are multiple projects, repeat the section for each.`

export function buildUserMessage(payload: DaySummaryPayload): string {
  const lines: string[] = [`Date: ${payload.date}`, '']

  for (const session of payload.sessions) {
    lines.push(`Project: ${session.project ?? 'unknown'}`)
    if (session.branch) lines.push(`Branch: ${session.branch}`)
    lines.push(`Time: ${session.startTime} – ${session.endTime} (${formatDuration(session.durationMinutes)})`)
    lines.push('Events:')
    for (const event of session.events) {
      const meta = Object.keys(event.metadata).length > 0 ? ` ${JSON.stringify(event.metadata)}` : ''
      const exitNote = event.exitCode !== null && event.exitCode !== 0 ? ` [exit ${event.exitCode}]` : ''
      lines.push(`  - ${event.category}${meta}${exitNote}`)
    }
    lines.push('')
  }

  return lines.join('\n')
}
