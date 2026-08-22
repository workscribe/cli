import type { DaySummaryPayload, WeekSummaryPayload } from './types'
import { formatDuration } from '../utils/format'
import { getActiveProfileAiContexts } from '../profiles/loader'

export const SYSTEM_PROMPT = `You write short developer work summaries. Focus on what the developer accomplished and what changed — not which tools or commands were used.

Here is an example:

INPUT:
Project: api-service
Branch: feature/auth
Duration: 2h 00m
Events:
  - versioning {"branch":"feature/auth"}
  - 2x dependencies {"tool":"npm","packages":["bcrypt","jsonwebtoken"]}
  - 8x testing [failed]
  - testing
  - 2x files {"tool":"mkdir"}
  - shipping {"message":"fix: auth token validation"}
  - shipping {"remote":"origin","branch":"feature/auth"}

OUTPUT:
- Added authentication dependencies (bcrypt, JWT)
- Debugged and resolved failing auth tests
- Committed and pushed the token validation fix

RULES — follow these exactly:

1. Interpret repeated events as patterns, not individual steps.
   - Many testing [failed] followed by a passing test = debugging a failure. Say "resolved failing X tests", not "ran tests multiple times".
   - Many versioning events = branch housekeeping. Fold into context, do not list each git command.

2. Omit utility commands entirely. File size checks, file reads, grep searches, and cat commands are research steps — they are not outcomes and must not appear in the summary.

3. Do not name the AI tool. For ai_session events: focus on what was built or committed. If a commits array is present in metadata, use those commit messages. Never write "via Claude Code", "using Claude Code", or similar — omit the tool name entirely.

4. For other events with a hint field: describe the developer's intent, not the raw command.

5. For dependencies events: infer the purpose from package names and describe the domain (bcrypt/jsonwebtoken → authentication, prisma/pg → database, jest/vitest → testing). For unfamiliar packages, name them directly.

6. Fold supporting events into the narrative. Building, shipping, versioning, and file operations are context — only make them a bullet when they are the primary activity (e.g. a standalone build fix or deploy with no accompanying commits).

7. Stick to what the events show. Do not infer subject matter from the branch name. Do not add details not derivable from the events.

Maximum 5 bullets. Output ONLY the bullet points, nothing else.`

export function getSystemPrompt(): string {
  const contexts = getActiveProfileAiContexts()
  if (contexts.length === 0) return SYSTEM_PROMPT
  return SYSTEM_PROMPT + '\n\n' + contexts.join('\n')
}

// Categories excluded from the AI payload by default:
// - exploring/note: handled separately (notes rendered before event list; exploring is raw file reads)
// - linting: lint/format runs are support noise, not meaningful work outcomes
// `other` is intentionally kept — hints give the AI context for commands that don't fit known patterns
// (e.g. docker compose up, make deploy, terraform apply). The prompt instructs the model to omit
// utility commands (wc, head) within that category.
export const DEFAULT_EXCLUDED_CATEGORIES = new Set(['exploring', 'note', 'linting'])

export function buildExcludedSet(includeCategories: string[] = []): Set<string> {
  const excluded = new Set(DEFAULT_EXCLUDED_CATEGORIES)
  for (const cat of includeCategories) excluded.delete(cat)
  return excluded
}

export function countExcludedEvents(
  sessions: DaySummaryPayload['sessions'],
  excluded: Set<string>
): Map<string, number> {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    for (const event of session.events) {
      if (excluded.has(event.category)) {
        counts.set(event.category, (counts.get(event.category) ?? 0) + 1)
      }
    }
  }
  return counts
}

export function buildUserMessage(payload: DaySummaryPayload, includeCategories: string[] = []): string {
  const excluded = buildExcludedSet(includeCategories)
  const lines: string[] = [`Date: ${payload.date}`, '']

  for (const session of payload.sessions) {
    lines.push(`Project: ${session.project ?? 'unknown'}`)
    if (session.branch) lines.push(`Branch: ${session.branch}`)
    lines.push(`Duration: ${formatDuration(session.durationMinutes)}`)

    for (const event of session.events) {
      if (event.category === 'note') {
        lines.push(`NOTE: ${event.metadata.text as string}`)
      }
    }

    lines.push('Events:')

    // Aggregate repeated events so the model sees "3x build" not 3 separate build lines
    const counts = new Map<string, number>()
    for (const event of session.events) {
      if (excluded.has(event.category)) continue
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

    for (const session of sessions) {
      const project = session.project ?? 'unknown'
      const branch = session.branch ? ` (${session.branch})` : ''
      lines.push(`  Project: ${project}${branch} — ${formatDuration(session.durationMinutes)}`)

      for (const event of session.events) {
        if (event.category === 'note') {
          lines.push(`  NOTE: ${event.metadata.text as string}`)
        }
      }

      const excluded = buildExcludedSet()
      const counts = new Map<string, number>()
      for (const event of session.events) {
        if (excluded.has(event.category)) continue
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
      const eventLine = [...counts.entries()].map(([key, count]) => `${count > 1 ? `${count}x ` : ''}${key}`).join(', ')
      lines.push(`  Events: ${eventLine}`)
    }

    lines.push('')
  }

  return lines.join('\n')
}
