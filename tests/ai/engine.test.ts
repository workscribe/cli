import { describe, it, expect } from 'vitest'
import { resolveEngine, engineLabel } from '../../src/ai/engine'
import { createTestConfig } from '../helpers/config'
import type { WorkscribeConfig } from '../../src/config'

function configWith(provider: string, engine?: WorkscribeConfig['summary']['engine']): WorkscribeConfig {
  const base = createTestConfig()
  return { ...base, ai: { ...base.ai, provider }, summary: { ...base.summary, engine } }
}

describe('resolveEngine', () => {
  it('uses the template when nothing is configured', () => {
    expect(resolveEngine(configWith(''))).toBe('template')
  })

  it('keeps a 1.x cloud provider config on the provider engine', () => {
    expect(resolveEngine(configWith('anthropic'))).toBe('provider')
  })

  it('maps a 1.x ollama provider config to the ollama engine', () => {
    expect(resolveEngine(configWith('ollama'))).toBe('ollama')
  })

  it('lets an explicit engine override a configured provider', () => {
    expect(resolveEngine(configWith('anthropic', 'template'))).toBe('template')
  })

  it('ignores an invalid hand-edited engine and derives one instead', () => {
    const config = configWith('anthropic', 'claude' as WorkscribeConfig['summary']['engine'])

    expect(resolveEngine(config)).toBe('provider')
  })

  it('lets an explicit engine apply with no provider configured', () => {
    expect(resolveEngine(configWith('', 'ollama'))).toBe('ollama')
  })
})

describe('engineLabel', () => {
  it('names the cloud provider for the provider engine', () => {
    expect(engineLabel(configWith('anthropic'))).toBe('anthropic')
  })

  it('names the engine otherwise', () => {
    expect(engineLabel(configWith(''))).toBe('template')
    expect(engineLabel(configWith('', 'ollama'))).toBe('ollama')
  })
})
