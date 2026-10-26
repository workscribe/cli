// Categories excluded from summary input by default:
// - exploring/note: handled separately (notes rendered before event list; exploring is raw file reads)
// - linting: lint/format runs are support noise, not meaningful work outcomes
// `other` is intentionally kept — hints give the summary context for commands that don't fit known patterns
// (e.g. docker compose up, make deploy, terraform apply).
// Only a type import, so the template engine and the --json contract can use this without loading profiles or the DB.
import type { SessionPayload } from '../ai/types'

export const DEFAULT_EXCLUDED_CATEGORIES = new Set(['exploring', 'note', 'linting'])

export function buildExcludedSet(includeCategories: string[] = []): Set<string> {
  const excluded = new Set(DEFAULT_EXCLUDED_CATEGORIES)
  for (const category of includeCategories) excluded.delete(category)
  return excluded
}

/** How many events of each excluded category the summary left out — for the footer under `workscribe summary`. */
export function countExcludedEvents(sessions: SessionPayload[], excluded: Set<string>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const session of sessions) {
    for (const event of session.events) {
      if (excluded.has(event.category)) counts.set(event.category, (counts.get(event.category) ?? 0) + 1)
    }
  }
  return counts
}
