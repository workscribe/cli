import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/ai/generic-provider', () => ({ GenericProvider: vi.fn() }))
import { getProvider } from '../../src/ai/router'
import { GenericProvider } from '../../src/ai/generic-provider'
import { TemplateProvider } from '../../src/ai/engines/template/provider'
import { PROVIDER_CONFIGS } from '../../src/ai/provider-config'
import { createTestConfig } from '../helpers/config'
import type { WorkscribeConfig } from '../../src/config'

function configWith(
  ai: Partial<WorkscribeConfig['ai']>,
  engine?: WorkscribeConfig['summary']['engine']
): WorkscribeConfig {
  const base = createTestConfig()
  return { ...base, ai: { ...base.ai, ...ai }, summary: { ...base.summary, engine } }
}

describe('getProvider', () => {
  it('returns the template engine when nothing is configured', () => {
    expect(getProvider(configWith({ provider: '', apiKey: '' }))).toBeInstanceOf(TemplateProvider)
  })

  it('keeps a 1.x cloud provider config on that provider', () => {
    expect(getProvider(configWith({ provider: 'anthropic', apiKey: 'sk-test' }))).toBeInstanceOf(GenericProvider)
  })

  it('lets summary.engine=template win over a configured provider', () => {
    expect(getProvider(configWith({ provider: 'anthropic', apiKey: 'sk-test' }, 'template'))).toBeInstanceOf(
      TemplateProvider
    )
  })

  it('uses ollama for summary.engine=ollama with no provider and no API key', () => {
    expect(getProvider(configWith({ provider: '', apiKey: '' }, 'ollama'))).toBeInstanceOf(GenericProvider)
  })

  it("gives the ollama engine Ollama defaults, not a configured cloud provider's settings", () => {
    getProvider(
      configWith(
        { provider: 'anthropic', apiKey: 'sk-secret', model: 'claude-haiku', baseUrl: 'https://api.example' },
        'ollama'
      )
    )

    const [providerConfig, model, apiKey, baseUrl] = vi.mocked(GenericProvider).mock.calls[0]
    expect(providerConfig).toBe(PROVIDER_CONFIGS.ollama)
    expect(model).toBe(PROVIDER_CONFIGS.ollama.defaultModel)
    expect(apiKey).toBe('')
    expect(baseUrl).toBe(PROVIDER_CONFIGS.ollama.defaultBaseUrl)
  })

  it('applies ai.model and ai.baseUrl to the ollama engine when no provider is configured', () => {
    getProvider(configWith({ provider: '', apiKey: '', model: 'qwen2.5', baseUrl: 'http://gpu-box:11434' }, 'ollama'))

    const [, model, , baseUrl] = vi.mocked(GenericProvider).mock.calls[0]
    expect(model).toBe('qwen2.5')
    expect(baseUrl).toBe('http://gpu-box:11434')
  })

  it('keeps model and base URL overrides for a 1.x ollama provider config', () => {
    getProvider(configWith({ provider: 'ollama', apiKey: '', model: 'phi3', baseUrl: 'http://box:11434' }))

    const [, model, , baseUrl] = vi.mocked(GenericProvider).mock.calls[0]
    expect(model).toBe('phi3')
    expect(baseUrl).toBe('http://box:11434')
  })

  it('rejects summary.engine=provider when no provider is set', () => {
    expect(() => getProvider(configWith({ provider: '', apiKey: '' }, 'provider'))).toThrow(
      'summary.engine is "provider" but ai.provider is not set'
    )
  })

  it('still requires an API key for cloud providers', () => {
    expect(() => getProvider(configWith({ provider: 'openai', apiKey: '' }))).toThrow('openai requires an API key')
  })

  it('still rejects unknown providers', () => {
    expect(() => getProvider(configWith({ provider: 'nope', apiKey: 'key' }))).toThrow('Unknown provider: "nope"')
  })
})
