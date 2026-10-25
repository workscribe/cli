// Categories excluded from summary input by default:
// - exploring/note: handled separately (notes rendered before event list; exploring is raw file reads)
// - linting: lint/format runs are support noise, not meaningful work outcomes
// `other` is intentionally kept — hints give the AI context for commands that don't fit known patterns
// (e.g. docker compose up, make deploy, terraform apply). The prompt instructs the model to omit
// utility commands (wc, head) within that category.
// Kept dependency-free so the template engine and the --json contract can use it without loading prompts/profiles.
export const DEFAULT_EXCLUDED_CATEGORIES = new Set(['exploring', 'note', 'linting'])

export function buildExcludedSet(includeCategories: string[] = []): Set<string> {
  const excluded = new Set(DEFAULT_EXCLUDED_CATEGORIES)
  for (const category of includeCategories) excluded.delete(category)
  return excluded
}
