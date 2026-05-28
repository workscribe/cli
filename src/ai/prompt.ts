import type { DaySummaryPayload, WeekSummaryPayload } from './types'
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
- Switched to the authentication feature branch
- Added JWT and bcrypt dependencies
- Resolved failing auth tests
- Committed authentication fixes

For ai_session events: describe what was built during the AI session using the tool name (e.g. "via Claude Code"). If commits followed the session, group them into the same bullet. Maximum 5 bullets.

Now summarise the following. Output ONLY the bullet points, nothing else. Maximum 5 bullets.`

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

export const WEEKLY_SYSTEM_PROMPT = `You write short weekly developer summaries. Here is an example:

INPUT:
Week: 2026-05-18 to 2026-05-22

Monday 2026-05-18:
  Project: api-service (feature/auth) — 2h 10m
  Events: 3x code_commit, 2x test_run, dependency_install

Tuesday 2026-05-19:
  Project: api-service (feature/auth) — 1h 30m
  Events: 2x code_commit, test_run, build

Wednesday 2026-05-20:
  Project: dashboard (main) — 3h 00m
  Events: 4x code_commit, 2x build, test_run

Thursday 2026-05-21:
  Project: api-service (feature/auth) — 1h 00m
  Events: code_commit {"message":"feat: merge auth"}, branch_switch

Friday 2026-05-22:
  Project: dashboard (main) — 2h 00m
  Events: 3x code_commit, build

OUTPUT:
## Week of 18 May — 9h 40m across 2 projects

**api-service** (Mon–Thu): Built and shipped the auth feature — JWT setup, token validation fixes, and final merge.
**dashboard** (Wed, Fri): Active development across 7 commits with builds passing.

Now summarise the following week. Output ONLY the summary — a one-line header then one bullet per active project. Maximum 4 bullets.`

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function buildWeeklyMessage(payload: WeekSummaryPayload): string {
  const lines: string[] = [`Week: ${payload.weekStart} to ${payload.weekEnd}`, '']

  for (const { date, sessions } of payload.days) {
    const dayName = DAY_NAMES[new Date(date + 'T00:00:00').getDay()]
    lines.push(`${dayName} ${date}:`)

    for (const s of sessions) {
      const project = s.project ?? 'unknown'
      const branch = s.branch ? ` (${s.branch})` : ''
      lines.push(`  Project: ${project}${branch} — ${formatDuration(s.durationMinutes)}`)

      const counts = new Map<string, number>()
      for (const e of s.events) {
        const meta = Object.keys(e.metadata).length > 0 ? ` ${JSON.stringify(e.metadata)}` : ''
        const failed = e.exitCode !== null && e.exitCode !== 0 ? ' [failed]' : ''
        const key = `${e.category}${meta}${failed}`
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      const eventLine = [...counts.entries()]
        .map(([k, n]) => `${n > 1 ? `${n}x ` : ''}${k}`)
        .join(', ')
      lines.push(`  Events: ${eventLine}`)
    }

    lines.push('')
  }

  return lines.join('\n')
}
