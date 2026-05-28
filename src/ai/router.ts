import type { AIProvider } from './types'
import type { WorkscribeConfig } from '../config'
import { AnthropicProvider } from './providers/anthropic'
import { OpenAIProvider } from './providers/openai'
import { OllamaProvider } from './providers/ollama'

export function getProvider(config: WorkscribeConfig): AIProvider {
  const { provider, apiKey, model, baseUrl } = config.ai

  if (!provider) {
    throw new Error(
      'No AI provider configured.\nRun: workscribe config set ai.provider <anthropic|openai|ollama|openai-compatible>'
    )
  }

  switch (provider) {
    case 'anthropic': {
      if (!apiKey) throw new Error('Anthropic requires an API key.\nRun: workscribe config set ai.apiKey <your-key>')
      return new AnthropicProvider(apiKey, model || undefined)
    }

    case 'openai': {
      if (!apiKey) throw new Error('OpenAI requires an API key.\nRun: workscribe config set ai.apiKey <your-key>')
      return new OpenAIProvider(apiKey, model || undefined)
    }

    case 'openai-compatible': {
      if (!apiKey)
        throw new Error('This provider requires an API key.\nRun: workscribe config set ai.apiKey <your-key>')
      if (!baseUrl)
        throw new Error('openai-compatible requires a base URL.\nRun: workscribe config set ai.baseUrl <url>')
      return new OpenAIProvider(apiKey, model || undefined, baseUrl)
    }

    case 'ollama': {
      return new OllamaProvider(model || undefined, baseUrl || undefined)
    }

    default:
      throw new Error(
        `Unknown provider: "${provider}"\nSupported providers: anthropic, openai, ollama, openai-compatible`
      )
  }
}
