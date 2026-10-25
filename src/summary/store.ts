import type { StoredEngine, SummaryEngine } from '../ai/engine'
import type { SessionSummaryRow } from '../db/types'

/** Engines whose output is worth caching — the template renders instantly, and a cached copy would only go stale. */
export type CachedEngine = Exclude<SummaryEngine, 'template'>

/** Engine name for summaries migrated from the 1.x `sessions.summary` column (written by a provider or Ollama). */
export const LEGACY_ENGINE = 'legacy' satisfies StoredEngine

// Higher wins when picking what to show: richer sources first. Template rows rank 0 — templates are
// rendered live, so any stored copy is a stale leftover and must never beat a fresh render.
const ENGINE_RANK: Record<StoredEngine, number> = { skill: 3, ollama: 2, provider: 2, legacy: 2, template: 0 }

export function isCachedEngine(engine: SummaryEngine): engine is CachedEngine {
  return engine !== 'template'
}

/** Identifies a session across rebuilds. Must match SESSION_KEY_SQL in migration 005. */
export function sessionKey(repoName: string | null, startedAt: string): string {
  return `${repoName ?? ''}|${startedAt}`
}

/** Engines whose stored summary a command may serve as its own — 1.x summaries count for provider/ollama. */
export function summaryEnginesFor(engine: CachedEngine): StoredEngine[] {
  return [engine, LEGACY_ENGINE]
}

function newestFirst(first: SessionSummaryRow, second: SessionSummaryRow): number {
  return second.created_at.localeCompare(first.created_at)
}

/** The newest summary this engine may serve, or null if it has to generate one. */
export function pickOwnSummary(rows: SessionSummaryRow[], engine: CachedEngine): string | null {
  const accepted = new Set<string>(summaryEnginesFor(engine))
  const [newest] = rows.filter((row) => accepted.has(row.engine)).sort(newestFirst)
  return newest?.text ?? null
}

/** The best stored summary for a session regardless of the configured engine (used by `context`). */
export function pickBestSummary(rows: SessionSummaryRow[]): string | null {
  // Rows come from the DB, so an engine name this build doesn't know is ignored like a template row
  const rank = (row: SessionSummaryRow): number => ENGINE_RANK[row.engine as StoredEngine] ?? 0
  const [best] = rows
    .filter((row) => rank(row) > 0)
    .sort((first, second) => rank(second) - rank(first) || newestFirst(first, second))
  return best?.text ?? null
}
