import type { AIProvider } from './types'
import type { WorkscribeConfig } from '../config'
import { GenericProvider } from './generic-provider'
import { PROVIDER_CONFIGS } from './provider-config'

export function getProvider(config: WorkscribeConfig): AIProvider {
  const { provider, apiKey = '', model, baseUrl } = config.ai

  if (!provider) {
    throw new Error(
      'No AI provider configured.\nRun: workscribe config set ai.provider <anthropic|openai|ollama|openai-compatible>'
    )
  }

  const configKey = provider === 'openai-compatible' ? 'openai' : provider
  const providerConfig = PROVIDER_CONFIGS[configKey]

  if (!providerConfig) {
    throw new Error(
      `Unknown provider: "${provider}"\nSupported providers: anthropic, openai, ollama, openai-compatible`
    )
  }

  if (provider !== 'ollama' && !apiKey) {
    throw new Error(`${provider} requires an API key.\nRun: workscribe config set ai.apiKey <your-key>`)
  }

  if (provider === 'openai-compatible' && !baseUrl) {
    throw new Error('openai-compatible requires a base URL.\nRun: workscribe config set ai.baseUrl <url>')
  }

  return new GenericProvider(
    providerConfig,
    model || providerConfig.defaultModel,
    apiKey,
    baseUrl || providerConfig.defaultBaseUrl,
    config.summary?.includeCategories ?? []
  )
}
