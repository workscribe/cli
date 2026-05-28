import { describe, it, expect } from 'vitest'
import { getConfigValue, setConfigValue } from '../../src/config'
import type { WorkscribeConfig } from '../../src/config'

// A clean config object to use as a base in tests
const BASE_CONFIG: WorkscribeConfig = {
  ai: {
    provider: '',
    apiKey: '',
    model: '',
    baseUrl: '',
  },
  session: {
    idleTimeout: 30,
  },
  capture: {
    ignore: ['cd', 'ls', 'pwd'],
  },
  redact: {
    extra: [],
  },
  summary: {
    format: 'markdown',
  },
}

describe('getConfigValue', () => {
  it('gets a top-level nested value', () => {
    expect(getConfigValue(BASE_CONFIG, 'session.idleTimeout')).toBe(30)
  })

  it('gets a string nested value', () => {
    const config = { ...BASE_CONFIG, ai: { ...BASE_CONFIG.ai, provider: 'anthropic' } }
    expect(getConfigValue(config, 'ai.provider')).toBe('anthropic')
  })

  it('gets an array value', () => {
    expect(getConfigValue(BASE_CONFIG, 'capture.ignore')).toEqual(['cd', 'ls', 'pwd'])
  })

  it('returns undefined for a missing key', () => {
    expect(getConfigValue(BASE_CONFIG, 'ai.nonexistent')).toBeUndefined()
  })

  it('returns undefined for a deeply missing key', () => {
    expect(getConfigValue(BASE_CONFIG, 'a.b.c.d')).toBeUndefined()
  })

  it('returns the whole nested object for a partial path', () => {
    const result = getConfigValue(BASE_CONFIG, 'ai')
    expect(result).toEqual(BASE_CONFIG.ai)
  })
})

describe('setConfigValue', () => {
  it('sets a nested string value', () => {
    const result = setConfigValue(BASE_CONFIG, 'ai.provider', 'anthropic')
    expect(result.ai.provider).toBe('anthropic')
  })

  it('sets ai.apiKey', () => {
    const result = setConfigValue(BASE_CONFIG, 'ai.apiKey', 'sk-test-123')
    expect(result.ai.apiKey).toBe('sk-test-123')
  })

  it('coerces numeric strings to numbers', () => {
    const result = setConfigValue(BASE_CONFIG, 'session.idleTimeout', '60')
    expect(result.session.idleTimeout).toBe(60)
    expect(typeof result.session.idleTimeout).toBe('number')
  })

  it('coerces "true" to boolean true', () => {
    const result = setConfigValue(BASE_CONFIG, 'ai.provider', 'true')
    expect(result.ai.provider).toBe(true)
  })

  it('coerces "false" to boolean false', () => {
    const result = setConfigValue(BASE_CONFIG, 'ai.provider', 'false')
    expect(result.ai.provider).toBe(false)
  })

  it('does not mutate the original config', () => {
    const original = JSON.parse(JSON.stringify(BASE_CONFIG)) as WorkscribeConfig
    setConfigValue(BASE_CONFIG, 'ai.provider', 'openai')
    expect(BASE_CONFIG.ai.provider).toBe(original.ai.provider)
  })

  it('preserves other keys when setting one value', () => {
    const result = setConfigValue(BASE_CONFIG, 'ai.provider', 'openai')
    expect(result.session.idleTimeout).toBe(30)
    expect(result.capture.ignore).toEqual(['cd', 'ls', 'pwd'])
    expect(result.ai.apiKey).toBe('')
  })

  it('sets summary format', () => {
    const result = setConfigValue(BASE_CONFIG, 'summary.format', 'json')
    expect(result.summary.format).toBe('json')
  })

  it('sets ai.baseUrl', () => {
    const result = setConfigValue(BASE_CONFIG, 'ai.baseUrl', 'https://api.groq.com/openai/v1')
    expect(result.ai.baseUrl).toBe('https://api.groq.com/openai/v1')
  })

  it('keeps URL as string (not coerced to number)', () => {
    const result = setConfigValue(BASE_CONFIG, 'ai.baseUrl', 'https://api.groq.com/openai/v1')
    expect(typeof result.ai.baseUrl).toBe('string')
  })
})
