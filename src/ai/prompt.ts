import type { DaySummaryPayload } from './types'
import { formatDuration } from '../utils/format'

export const SYSTEM_PROMPT = `You write short developer work summaries. Here is an example:

INPUT:
Project: api-service
Branch: feature/auth
Duration: 1h 30m
Events:
  - branch_switch {"branch":"feature/auth"}
  - 2x dependency_install {"tool":"npm","packages":["bcrypt","jsonwebtoken"]}
  - 2x test_run {"tool":"jest"} [failed]
  - test_run {"tool":"jest"}
  - code_commit {"message":"fix: auth token validation"}

OUTPUT:
## api-service (feature/auth) — 1h 30m
- Switched to the authentication feature branch
- Added JWT and bcrypt dependencies
- Resolved failing auth tests
- Committed authentication fixes

Now summarise the following. Output ONLY the summary, nothing else. Maximum 5 bullets.`

export function buildUserMessage(payload: DaySummaryPayload): string {
  const lines: string[] = [`Date: ${payload.date}`, '']

  for (const session of payload.sessions) {
    lines.push(`Project: ${session.project ?? 'unknown'}`)
    if (session.branch) lines.push(`Branch: ${session.branch}`)
    lines.push(`Duration: ${formatDuration(session.durationMinutes)}`)
    lines.push('Events:')

    // Aggregate repeated events so the model sees "3x build" not 3 separate build lines
    const counts = new Map<string, number>()
    for (const event of session.events) {
      const meta = Object.keys(event.metadata).length > 0 ? ` ${JSON.stringify(event.metadata)}` : ''
      const failed = event.exitCode !== null && event.exitCode !== 0 ? ' [failed]' : ''
      const key = `${event.category}${meta}${failed}`
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }

    for (const [key, count] of counts) {
      lines.push(`  - ${count > 1 ? `${count}x ` : ''}${key}`)
    }

    lines.push('')
  }

  return lines.join('\n')
}
