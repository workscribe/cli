import type { WorkscribeConfig } from '../config'

export const SUMMARY_ENGINES = ['template', 'ollama', 'provider'] as const

export type SummaryEngine = (typeof SUMMARY_ENGINES)[number]

/** Every engine a stored summary can come from: the configurable ones, the agent skill, and 1.x summaries. */
export type StoredEngine = SummaryEngine | 'skill' | 'legacy'

export function isSummaryEngine(value: unknown): value is SummaryEngine {
  return SUMMARY_ENGINES.includes(value as SummaryEngine)
}

/**
 * The engine that writes summaries: a valid summary.engine wins, otherwise a configured ai.provider
 * keeps its 1.x behavior, and with nothing configured the offline template is used. An invalid
 * summary.engine (hand-edited config) is ignored rather than treated as a provider name.
 */
export function resolveEngine(config: WorkscribeConfig): SummaryEngine {
  const explicit = config.summary?.engine
  if (isSummaryEngine(explicit)) return explicit
  if (config.ai.provider === 'ollama') return 'ollama'
  if (config.ai.provider) return 'provider'
  return 'template'
}

/** Name shown in "Generating summary via …" and failure messages — the provider name for cloud providers. */
export function engineLabel(config: WorkscribeConfig): string {
  const engine = resolveEngine(config)
  return engine === 'provider' ? config.ai.provider : engine
}
