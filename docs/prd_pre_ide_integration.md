# Pre-IDE Integration Work Items

These are the four improvements to ship before building IDE extensions. Each item is self-contained and can be merged independently.

---

## 1. `workscribe undo` — Delete Last N Captured Events

### Problem

Capture runs in the background on every command. Sometimes a user runs something they don't want journaled (a personal command, a mistaken `cd`, noise). There is currently no way to remove events after capture.

### Approach

Add an `undo` command that deletes the most recent N events from the `events` table. This is a soft undo — it removes raw events only. If sessions have already been computed from those events, the stale sessions are also invalidated so they rebuild on next access.

### Implementation Plan

**1. DB function — `src/db/index.ts`**

Add two new query functions:

```ts
// Returns the most recent N event IDs for preview
export function getLastEventIds(n: number): number[] {
  const rows = db
    .prepare('SELECT id FROM events ORDER BY id DESC LIMIT ?')
    .all(n) as { id: number }[]
  return rows.map((r) => r.id)
}

// Deletes events by ID array and invalidates any sessions that contained them
export function deleteEventsByIds(ids: number[]): void {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(', ')
  // Find affected dates first (to invalidate sessions)
  const affectedDates = db
    .prepare(`SELECT DISTINCT date FROM events WHERE id IN (${placeholders})`)
    .all(...ids) as { date: string }[]

  db.prepare(`DELETE FROM events WHERE id IN (${placeholders})`).run(...ids)

  // Invalidate sessions for affected dates so they rebuild
  for (const { date } of affectedDates) {
    db.prepare('DELETE FROM sessions WHERE date = $date').run({ date })
  }
}
```

**2. CLI command — `src/cli/undo.ts`** (new file)

```ts
import { Command } from 'commander'
import { getLastEventIds, deleteEventsByIds, getEventsByIds } from '../db'
import { log } from '../utils/logger'

export function registerUndo(program: Command): void {
  program
    .command('undo')
    .description('Remove the last N captured events')
    .option('-n, --count <number>', 'number of events to remove', '1')
    .option('--dry-run', 'preview what would be deleted without deleting')
    .action((opts) => {
      const count = parseInt(opts.count, 10)
      if (isNaN(count) || count < 1) {
        log.error('--count must be a positive integer')
        process.exit(1)
      }

      const ids = getLastEventIds(count)
      if (ids.length === 0) {
        log.plain('No events to undo.')
        return
      }

      const events = getEventsByIds(ids)
      log.plain('')
      log.plain(`Events to remove (${events.length}):`)
      for (const e of events) {
        log.plain(`  ${e.captured_at}  ${e.category}  ${e.raw_command ?? ''}`)
      }
      log.plain('')

      if (opts.dryRun) {
        log.plain('Dry run — nothing deleted.')
        return
      }

      deleteEventsByIds(ids)
      log.success(`Removed ${ids.length} event${ids.length > 1 ? 's' : ''}.`)
    })
}
```

**3. Register in `src/index.ts`**

```ts
import { registerUndo } from './cli/undo'
// ...
registerUndo(program)
```

**4. Add `getEventsByIds` to `src/db/index.ts`**

```ts
export function getEventsByIds(ids: number[]): EventRow[] {
  if (ids.length === 0) return []
  const placeholders = ids.map(() => '?').join(', ')
  return db
    .prepare(`SELECT * FROM events WHERE id IN (${placeholders}) ORDER BY id DESC`)
    .all(...ids) as EventRow[]
}
```

### Edge Cases

- `--count` larger than total event count: silently deletes all available events, does not error
- Events already part of an exported markdown: undo does not modify export files, only the DB
- Running `undo` twice: safe, second call just removes the next N events

### Tests

Add `tests/undo.test.ts` testing:
- `getLastEventIds` returns correct IDs in descending order
- `deleteEventsByIds` removes rows and invalidates sessions for affected dates
- `--dry-run` flag prints preview but makes no DB changes

---

## 2. Fix Project Name in Summaries

### Problem

The project name shown in summaries comes from the folder name of the git root (`path.basename(root)` in `src/capture/git.ts`). If the user's local clone is named differently from the actual project — e.g., cloned into `~/sandbox/chronicle` instead of `~/sandbox/workscribe` — the summary shows `chronicle`, not `workscribe`.

This is the trickiest item because there are multiple authoritative sources for the "real" name and each has trade-offs:

| Source | Pros | Cons |
|---|---|---|
| Folder name | Always available, zero overhead | Breaks when local clone has a different name |
| `package.json` `name` field | Reflects intended project name | Only works for Node projects; `@scope/pkg` needs stripping |
| `git remote get-url origin` | Language-agnostic, reflects canonical repo name | Slower exec; fails for repos with no remote |
| Config override | User always wins | Requires manual setup |

### Approach

Implement a priority chain in `getGitContext`:

```
config override (per directory)
  → git remote origin URL  (extract repo name slug)
    → package.json "name"  (strip @scope/ prefix)
      → folder name        (current behaviour)
```

### Implementation Plan

**1. Update `src/capture/git.ts`**

```ts
import { execSync } from 'child_process'
import path from 'path'
import fs from 'fs'

function nameFromRemote(cwd: string): string | null {
  try {
    const url = execSync('git remote get-url origin', {
      cwd,
      timeout: 2000,
      stdio: 'pipe',
    }).toString().trim()

    // Handles: git@github.com:org/repo.git  and  https://github.com/org/repo.git
    const match = url.match(/\/([^/]+?)(?:\.git)?$/)
    return match ? match[1] : null
  } catch {
    return null
  }
}

function nameFromPackageJson(root: string): string | null {
  try {
    const pkgPath = path.join(root, 'package.json')
    const raw = fs.readFileSync(pkgPath, 'utf-8')
    const pkg = JSON.parse(raw) as { name?: string }
    if (!pkg.name) return null
    // Strip @scope/ prefix
    return pkg.name.replace(/^@[^/]+\//, '')
  } catch {
    return null
  }
}

export function getGitContext(cwd: string, nameOverride?: string | null): GitContext {
  try {
    const root = execSync('git rev-parse --show-toplevel', {
      cwd, timeout: 2000, stdio: 'pipe',
    }).toString().trim()

    const repoName =
      nameOverride ??
      nameFromRemote(root) ??
      nameFromPackageJson(root) ??
      path.basename(root)

    // ... existing branch detection unchanged ...

    return { repoName, branch }
  } catch {
    return { repoName: null, branch: null }
  }
}
```

**2. Config override — `src/config/index.ts`**

Add an optional `projects` map to `WorkscribeConfig`:

```ts
export interface WorkscribeConfig {
  // ... existing fields ...
  projects?: Record<string, string>  // absolute path → display name
}
```

**3. Read override in `src/capture/index.ts`**

```ts
const config = readConfig()
const override = config.projects?.[cwd] ?? null
const { repoName, branch } = getGitContext(cwd, override)
```

**4. Expose via CLI — `src/cli/config.ts`**

Document that users can run:

```bash
workscribe config set projects./Users/me/sandbox/chronicle workscribe
```

This uses the existing `setConfigValue` path traversal, which already handles nested keys.

**5. Caching note**

`repoName` is stored on the `events` row at capture time via `src/db/index.ts:insertEvent`. Once events are captured with the wrong name, `undo` + re-capture is the correct fix. The undo command from item 1 enables this flow.

### Trade-offs and Risks

- `git remote get-url origin` adds ~5ms to every capture; acceptable because capture is already running `git rev-parse` and `git branch --show-current`
- `package.json` parse: reads one small file; only attempted if remote lookup fails
- A monorepo with a single git root but multiple `package.json` files will use the root `package.json` name (expected behaviour)

### Tests

Add cases to `tests/git.test.ts` (or create it):
- Remote URL with `.git` suffix
- Remote URL without `.git` suffix (some GitLab URLs)
- SSH remote URL (`git@github.com:org/repo.git`)
- `package.json` with scoped name (`@workscribe/cli` → `cli`)
- `package.json` missing: falls back to folder name
- `nameOverride` provided: always wins

---

## 3. Slack / Webhook Integration

### Problem

After running `workscribe summary`, the output is only visible in the terminal. Users who post daily standups to Slack have to manually copy-paste the summary. A `--slack` flag would complete the loop.

### Approach

- Store a webhook URL in config (`integrations.slackWebhook`)
- `workscribe summary --slack` generates the summary then POSTs it to the webhook
- Support generic webhook too (`integrations.webhook`) so it works with Discord, Teams, custom endpoints, etc.
- No new runtime dependency — use the same `fetchWithTimeout` already used by AI providers

### Implementation Plan

**1. Config — `src/config/index.ts`**

```ts
export interface WorkscribeConfig {
  // ... existing fields ...
  integrations?: {
    slackWebhook?: string
    webhook?: string        // generic: POST { text: "..." }
  }
}
```

**2. Webhook sender — `src/integrations/webhook.ts`** (new file)

```ts
import { fetchWithTimeout } from '../ai/fetch'

export interface WebhookPayload {
  text: string
}

export async function postToWebhook(url: string, text: string): Promise<void> {
  const response = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  }, 10_000)

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Webhook POST failed ${response.status}: ${body}`)
  }
}
```

Slack Incoming Webhooks accept `{ text: "..." }` directly — no Slack SDK needed.

**3. Update `src/cli/summary.ts`**

Add `--slack` and `--webhook` options:

```ts
.option('--slack', 'post summary to Slack webhook from config')
.option('--webhook <url>', 'post summary to a custom webhook URL')
```

After the summary is generated and printed:

```ts
const webhookUrl =
  opts.webhook ??
  (opts.slack ? config.integrations?.slackWebhook : undefined)

if (webhookUrl) {
  try {
    log.info('Posting to webhook…')
    await postToWebhook(webhookUrl, summary)
    log.success('Posted.')
  } catch (e) {
    log.error(`Webhook failed: ${(e as Error).message}`)
    // non-fatal: summary was already printed
  }
}
```

**4. Config set UX**

Users configure their webhook once:

```bash
workscribe config set integrations.slackWebhook https://hooks.slack.com/services/...
```

The existing `setConfigValue` traversal handles nested keys already.

**5. Security note**

The webhook URL is stored in `~/.workscribe/config.json` which is written with `0600` permissions. The `maskValue` display function in `config.ts` already masks keys containing `webhook` in the sensitive key list — add `webhook` to `SENSITIVE_KEYS`:

```ts
const SENSITIVE_KEYS = new Set(['apiKey', 'api_key', 'secret', 'token', 'password', 'passwd', 'webhook'])
```

### Tests

Add `tests/webhook.test.ts`:
- `postToWebhook` sends correct JSON body
- `postToWebhook` throws on non-2xx response
- `--slack` without config key set: prints clear error, does not crash

---

## 4. Weekly Summary Prompt Tuning

### Problem

`workscribe summary --week` currently calls `getOrBuildSessions` for a single date and the `--week` flag is not implemented — it resolves to today only. Even if it were implemented, the current single-session prompt is wrong for multi-day aggregation: it was designed for one focused session and produces a flat bullet list that loses the day-over-day narrative.

A weekly summary needs a different prompt: it should identify themes, highlight progress across days, and remain concise even when there are 20+ sessions across 5 days.

### Current State

`src/cli/summary.ts` has `--week` as a declared option but the action handler ignores it — `date` defaults to today regardless.

### Implementation Plan

**1. Fix `--week` date range in `src/cli/summary.ts`**

```ts
import { startOfWeek, endOfWeek, eachDayOfRange } from '../utils/format'

if (opts.week) {
  const days = eachDayOfRange(startOfWeek(todayDate()), todayDate())
  // collect sessions across all days
  const allSessions: { date: string; sessions: SessionRow[] }[] = []
  for (const day of days) {
    const s = getOrBuildSessions(day)
    if (s.length > 0) allSessions.push({ date: day, sessions: s })
  }
  if (allSessions.length === 0) {
    log.plain('No activity captured this week.')
    return
  }
  // ... build weekly payload and call summarizeWeek(payload)
}
```

**2. Add date utilities to `src/utils/format.ts`**

```ts
// Returns Monday of the ISO week containing dateStr (YYYY-MM-DD)
export function startOfWeek(dateStr: string): string {
  const d = new Date(dateStr)
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

// Returns all YYYY-MM-DD strings from start to end inclusive
export function eachDayOfRange(start: string, end: string): string[] {
  const days: string[] = []
  const cur = new Date(start)
  const last = new Date(end)
  while (cur <= last) {
    days.push(cur.toISOString().slice(0, 10))
    cur.setDate(cur.getDate() + 1)
  }
  return days
}
```

**3. Weekly payload type — `src/ai/types.ts`**

```ts
export interface WeekSummaryPayload {
  weekStart: string
  weekEnd: string
  days: {
    date: string
    sessions: SessionPayload[]
  }[]
}
```

**4. Weekly prompt — `src/ai/prompt.ts`**

The key insight for small models: give them a per-day structure and ask for a theme-based output, not a flat list.

```ts
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
```

**5. `buildWeeklyMessage` in `src/ai/prompt.ts`**

```ts
export function buildWeeklyMessage(payload: WeekSummaryPayload): string {
  const lines: string[] = [`Week: ${payload.weekStart} to ${payload.weekEnd}`, '']
  const dayNames = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

  for (const { date, sessions } of payload.days) {
    const dayName = dayNames[new Date(date).getDay()]
    lines.push(`${dayName} ${date}:`)
    for (const s of sessions) {
      lines.push(`  Project: ${s.project ?? 'unknown'}${s.branch ? ` (${s.branch})` : ''} — ${formatDuration(s.durationMinutes)}`)
      // Aggregate events same as daily
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
```

**6. `summarizeWeek` on providers**

Add `summarizeWeek?(payload: WeekSummaryPayload): Promise<string>` as an optional method on `AIProvider`. Providers that don't implement it fall back to calling `summarize` with a flattened daily payload (preserves backward compat with custom providers).

Router:

```ts
if (provider.summarizeWeek) {
  summary = await provider.summarizeWeek(weeklyPayload)
} else {
  // fallback: concatenate daily summaries
}
```

**7. Caching weekly summaries**

Weekly summaries are not cached per-session (sessions already have daily cache). Instead, cache in a flat file: `~/.workscribe/weekly-cache/<YYYY-WW>.md`. Check on load, write after generation. Clear with `--fresh`.

### Tests

Add to `tests/format.test.ts`:
- `startOfWeek` returns correct Monday for each weekday input
- `eachDayOfRange` returns correct array including both endpoints

Add `tests/weekly-prompt.test.ts`:
- `buildWeeklyMessage` produces expected format for a two-day payload
- Empty days are skipped (no blank day entries)
