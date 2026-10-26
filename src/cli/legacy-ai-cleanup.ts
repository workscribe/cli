import prompts from 'prompts'
import { log } from '../utils/logger'
import { writeConfig, type WorkscribeConfig } from '../config'
import { hasLegacyAiSettings, withoutLegacyAiSettings } from '../summary/legacy-ai'

/** Part of `init`: 2.0 removed AI providers, so offer to delete the 1.x settings — they can include a stored API key. */
export async function offerLegacyAiCleanup(config: WorkscribeConfig): Promise<WorkscribeConfig> {
  if (!hasLegacyAiSettings(config)) return config
  log.plain('')
  const { removeLegacyAi } = await prompts({
    type: 'confirm',
    name: 'removeLegacyAi',
    message:
      'Your config has AI provider settings from Workscribe 1.x (including any API key) that 2.0 no longer uses. Remove them?',
    initial: true,
  })
  if (!removeLegacyAi) {
    log.info('Kept the old AI settings — they are ignored, and workscribe init can remove them later')
    return config
  }
  const cleaned = withoutLegacyAiSettings(config)
  writeConfig(cleaned)
  log.success('Removed the old AI provider settings from your config')
  return cleaned
}
