import type { DaySummaryPayload, WeekSummaryPayload } from './types'
import { formatDuration } from '../utils/format'
import { getActiveProfileAiContexts } from '../profiles/loader'

export const SYSTEM_PROMPT = `You write short developer work summaries. Here is an example:

INPUT:
Project: api-service
Branch: feature/auth
Duration: 2h 00m
Events:
  - versioning {"branch":"feature/auth"}
  - 2x dependencies {"tool":"npm","packages":["bcrypt","jsonwebtoken"]}
  - 2x testing {"tool":"jest"} [failed]
  - testing {"tool":"jest"}
  - 2x files {"tool":"mkdir"}
  - shipping {"message":"fix: auth token validation"}
  - shipping {"remote":"origin","branch":"feature/auth"}

OUTPUT:
- Switched to the authentication feature branch and added authentication dependencies (bcrypt, JWT)
- Resolved failing auth tests
- Committed and pushed authentication fixes

For dependencies events with a packages field: infer the purpose of packages from their names and describe the domain, not just the packages. Examples: bcrypt/jsonwebtoken → authentication, prisma/mongoose/pg → database, jest/vitest/mocha → testing, axios/got/node-fetch → HTTP client, stripe/paypal → payments, socket.io/ws → real-time. Use your knowledge of common packages. For unfamiliar packages, name them directly without guessing their domain.

Events like shipping (pushes), building, versioning (branch switches, stash), files (file ops, env vars), and infrastructure provide context — fold them into the surrounding narrative rather than listing them as separate bullets. Only surface them directly when they are the main activity (e.g. a standalone build fix, a deploy, or a significant restructure with no accompanying commits).

For ai_session events: describe what was built during the AI session using the tool name (e.g. "via Claude Code"). If a commits array is present in metadata, use those commit messages to describe what was built. Group all activity from the session into one narrative bullet.

For other events with a hint field: interpret the command snippet and describe the activity in plain language. Do not quote the raw command.

Maximum 5 bullets. Output ONLY the bullet points, nothing else.`

export function getSystemPrompt(): string {
  const contexts = getActiveProfileAiContexts()
  if (contexts.length === 0) return SYSTEM_PROMPT
  return SYSTEM_PROMPT + '\n\n' + contexts.join('\n')
}

// exploring (grep/find/cat) is excluded — read-only investigation adds no signal to work summaries
const EXCLUDED = new Set(['exploring'])

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
      if (EXCLUDED.has(event.category)) continue
      const failed = event.exitCode !== null && event.exitCode !== 0 ? ' [failed]' : ''
      let key: string
      if (event.hint) {
        key = `other  [${event.hint}]${failed}`
      } else {
        const meta = Object.keys(event.metadata).length > 0 ? ` ${JSON.stringify(event.metadata)}` : ''
        key = `${event.category}${meta}${failed}`
      }
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
        if (EXCLUDED.has(e.category)) continue
        const failed = e.exitCode !== null && e.exitCode !== 0 ? ' [failed]' : ''
        let key: string
        if (e.hint) {
          key = `other  [${e.hint}]${failed}`
        } else {
          const meta = Object.keys(e.metadata).length > 0 ? ` ${JSON.stringify(e.metadata)}` : ''
          key = `${e.category}${meta}${failed}`
        }
        counts.set(key, (counts.get(key) ?? 0) + 1)
      }
      const eventLine = [...counts.entries()].map(([k, n]) => `${n > 1 ? `${n}x ` : ''}${k}`).join(', ')
      lines.push(`  Events: ${eventLine}`)
    }

    lines.push('')
  }

  return lines.join('\n')
}
