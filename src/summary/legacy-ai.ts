// Workscribe 2.0 removed AI providers (cloud and Ollama). These helpers spot 1.x settings so users hear about
// it once per run, can't set them again by accident, and can have them (and any stored API key) removed.
import type { WorkscribeConfig } from '../config'

/** The only `summary.engine` value 2.0 still means — setting it is harmless, so it isn't a leftover. */
export const TEMPLATE_ENGINE = 'template'

const LEGACY_AI_FIELDS = ['provider', 'apiKey', 'model', 'baseUrl'] as const

const REMOVED_HEADLINE = 'AI providers were removed in Workscribe 2.0 — summaries now use the offline template engine.'

const SKILL_HINT =
  'For AI-written summaries, install the Workscribe skill and ask your coding agent:\n  workscribe skill install'

/** Why `config set` refuses `ai.*` and `summary.engine`, and what to do instead. */
export const REMOVED_AI_SETTING_MESSAGE = `${REMOVED_HEADLINE}\n${SKILL_HINT}`

export function hasLegacyAiSettings(config: WorkscribeConfig): boolean {
  const hasAiField = LEGACY_AI_FIELDS.some((field) => Boolean(config.ai?.[field]))
  const engine = config.summary?.engine
  return hasAiField || (engine !== undefined && engine !== TEMPLATE_ENGINE)
}

/** The once-per-run notice for a 1.x config, or null when there's nothing left over. `configPath` is shown as-is. */
export function describeLegacyAiSettings(config: WorkscribeConfig, configPath: string): string | null {
  if (!hasLegacyAiSettings(config)) return null
  return (
    `${REMOVED_HEADLINE}\n${SKILL_HINT}\n` +
    `Your old AI settings (including any API key) are still in ${configPath}. To remove them, run:\n  workscribe init`
  )
}

/** `ai`, `ai.<anything>`, `summary.engine` and anything under it, in any case — settings `config set` refuses. */
export function isRemovedAiSetting(key: string): boolean {
  const normalizedKey = key.toLowerCase()
  return ['ai', 'summary.engine'].some(
    (removed) => normalizedKey === removed || normalizedKey.startsWith(`${removed}.`)
  )
}

/** A copy of the config without the 1.x AI settings — what `init` saves when the user agrees to remove them. */
export function withoutLegacyAiSettings(config: WorkscribeConfig): WorkscribeConfig {
  const cleaned = structuredClone(config)
  delete cleaned.ai
  delete cleaned.summary.engine
  return cleaned
}
