// Which agents share a capture path with something else, read from their integrations' `overlaps`. Kept apart from
// `hooks/index.ts` so capture can ask without importing an agent's installer.
import { AI_HOOK_INTEGRATIONS } from './index'
import type { HookOverlaps } from './types'

/** The `--source` of every agent whose integration says it has this overlap. */
export function agentSourcesWith(overlap: keyof HookOverlaps): string[] {
  return Object.values(AI_HOOK_INTEGRATIONS)
    .filter((integration) => integration.overlaps?.[overlap] === true)
    .map((integration) => integration.source)
}

/** The `--source` of every agent with an integration: what tells an agent's row from an editor's. */
export function allAgentSources(): string[] {
  return Object.values(AI_HOOK_INTEGRATIONS).map((integration) => integration.source)
}
