import type { AIProvider } from './types'
import type { WorkscribeConfig } from '../config'
import { GenericProvider } from './generic-provider'
import { PROVIDER_CONFIGS } from './provider-config'
import { resolveEngine } from './engine'
import { TemplateProvider } from './engines/template/provider'

/** The provider whose settings apply: `ollama` for the ollama engine even when ai.provider is unset. */
function effectiveProviderName(config: WorkscribeConfig): string {
  if (resolveEngine(config) === 'ollama') return 'ollama'
  if (!config.ai.provider) {
    throw new Error(
      'summary.engine is "provider" but ai.provider is not set.\nRun: workscribe config set ai.provider <anthropic|openai|gemini|groq|ollama|openai-compatible>'
    )
  }
  return config.ai.provider
}

export function getProvider(config: WorkscribeConfig): AIProvider {
  const includeCategories = config.summary?.includeCategories ?? []
  if (resolveEngine(config) === 'template') return new TemplateProvider(includeCategories)

  const provider = effectiveProviderName(config)
  // ai.model/baseUrl/apiKey belong to ai.provider — when the ollama engine is chosen while a *different*
  // provider is configured, they must not reach Ollama (wrong model, cloud URL, leaked key). With no
  // provider configured they are the user's Ollama settings (e.g. ai.model qwen2.5) and apply as-is.
  const isAnotherProvidersSettings = Boolean(config.ai.provider) && provider !== config.ai.provider
  const settings = isAnotherProvidersSettings ? { apiKey: '', model: '', baseUrl: '' } : config.ai
  const { apiKey = '', model, baseUrl } = settings
  const configKey = provider === 'openai-compatible' ? 'openai' : provider
  const providerConfig = PROVIDER_CONFIGS[configKey]

  if (!providerConfig) {
    throw new Error(
      `Unknown provider: "${provider}"\nSupported providers: anthropic, openai, gemini, groq, ollama, openai-compatible`
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
    includeCategories
  )
}
