// What the story's Read line needs git for: which repository a folder is in, and which paths that repository ignores
// (the spec says a git-ignored file is never mentioned). One budget covers every question of a summary; once it is spent,
// or whenever git can't answer, the answer is "can't say" and the Read line stays out. Calls git, so it isn't pure.
import { getIgnoredPaths, getRepoRootOf } from './git-commits'
import type { ReadPathResolver } from './event-reads'

/** Enough for a day's few repositories; a slow git leaves the Read line out rather than slowing the summary. */
export const READ_RESOLVER_BUDGET_MS = 1500

/** Answers within `budgetMs` in all, counted from now; `now` is a parameter so a test can spend the budget. */
export function createReadResolver(budgetMs = READ_RESOLVER_BUDGET_MS, now: () => number = Date.now): ReadPathResolver {
  const deadline = now() + budgetMs
  const repositories = new Map<string, string | null>()
  const timeLeftMs = (): number => Math.ceil(deadline - now())

  return {
    repoRootOf(cwd) {
      const known = repositories.get(cwd)
      if (known !== undefined) return known
      const root = timeLeftMs() > 0 ? getRepoRootOf(cwd, timeLeftMs()) : null
      repositories.set(cwd, root)
      return root
    },
    ignoredAmong(repoRoot, paths) {
      return timeLeftMs() > 0 ? getIgnoredPaths(repoRoot, paths, timeLeftMs()) : null
    },
  }
}
