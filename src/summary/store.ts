import type { StoredEngine } from '../ai/engine'
import { localDateOf } from '../utils/format'

/** Engine name for summaries migrated from the 1.x `sessions.summary` column (written by a provider or Ollama). */
export const LEGACY_ENGINE = 'legacy' satisfies StoredEngine

/** Engine name for summaries the Workscribe agent skill saved with `sessions summary set`. */
export const SKILL_ENGINE = 'skill' satisfies StoredEngine

// Higher wins when picking what to show: richer sources first. Template rows rank 0 — templates are
// rendered live, so any stored copy is a stale leftover and must never beat a fresh render.
const ENGINE_RANK: Record<StoredEngine, number> = { skill: 3, ollama: 2, provider: 2, legacy: 2, template: 0 }

/** Summaries a 1.x AI provider or Ollama wrote. 2.0 no longer writes these, but still shows them for their sessions. */
const LEGACY_AI_ENGINES = new Set<string>(['provider', 'ollama', LEGACY_ENGINE])

/** Identifies a session across rebuilds. Must match SESSION_KEY_SQL in migration 005. */
export function sessionKey(repoName: string | null, startedAt: string): string {
  return `${repoName ?? ''}|${startedAt}`
}

export interface ParsedSessionKey {
  repoName: string | null
  startedAt: string
}

/** Reverses sessionKey(). Null for a malformed key: no `|`, or a start that isn't a timestamp. */
export function parseSessionKey(key: string): ParsedSessionKey | null {
  const separator = key.lastIndexOf('|')
  if (separator === -1) return null
  const startedAt = key.slice(separator + 1)
  if (startedAt === '' || Number.isNaN(new Date(startedAt).getTime())) return null
  const repoName = key.slice(0, separator)
  return { repoName: repoName === '' ? null : repoName, startedAt }
}

/** The local day a session key's thread started on (`2026-11-23`), or null for a key that isn't one. */
export function dayOfSessionKey(key: string): string | null {
  const parsed = parseSessionKey(key)
  return parsed === null ? null : localDateOf(parsed.startedAt)
}

/** What picking a summary reads from a stored one — `summary` rows fit. */
export interface RankableSummary {
  engine: string
  text: string
  created_at: string
}

function newestFirst(first: RankableSummary, second: RankableSummary): number {
  return second.created_at.localeCompare(first.created_at)
}

export interface SavedSummary {
  text: string
  fromSkill: boolean
}

/**
 * What `workscribe summary` can show for a session instead of rendering the template: a summary the agent
 * skill saved wins (it was written with more context), else one a 1.x AI provider wrote for that session.
 */
export function pickSavedSummary(rows: RankableSummary[]): SavedSummary | null {
  const [newestSkill] = rows.filter((row) => row.engine === SKILL_ENGINE).sort(newestFirst)
  if (newestSkill) return { text: newestSkill.text, fromSkill: true }
  const [newestLegacy] = rows.filter((row) => LEGACY_AI_ENGINES.has(row.engine)).sort(newestFirst)
  return newestLegacy ? { text: newestLegacy.text, fromSkill: false } : null
}

/** The best stored summary for a session regardless of the configured engine (used by `context`). */
export function pickBestSummary(rows: RankableSummary[]): string | null {
  // Rows come from the DB, so an engine name this build doesn't know is ignored like a template row
  const rank = (row: RankableSummary): number => ENGINE_RANK[row.engine as StoredEngine] ?? 0
  const [best] = rows
    .filter((row) => rank(row) > 0)
    .sort((first, second) => rank(second) - rank(first) || newestFirst(first, second))
  return best?.text ?? null
}
