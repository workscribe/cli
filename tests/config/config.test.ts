import { describe, it, expect } from 'vitest'
import { getConfigValue, setConfigValue } from '../../src/config'
import type { WorkscribeConfig } from '../../src/config'

// A clean config object to use as a base in tests
const BASE_CONFIG = {
  session: {
    idleTimeout: 30,
  },
  git: {
    qualifyRepoName: false,
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
  integrations: {
    webhook: '',
  },
} as unknown as WorkscribeConfig

describe('getConfigValue', () => {
  it('gets a top-level nested value', () => {
    expect(getConfigValue(BASE_CONFIG, 'session.idleTimeout')).toBe(30)
  })

  it('gets a string nested value', () => {
    const config = { ...BASE_CONFIG, integrations: { webhook: 'https://example.com/hook' } }
    expect(getConfigValue(config, 'integrations.webhook')).toBe('https://example.com/hook')
  })

  it('gets an array value', () => {
    expect(getConfigValue(BASE_CONFIG, 'capture.ignore')).toEqual(['cd', 'ls', 'pwd'])
  })

  it('returns undefined for a missing key', () => {
    expect(getConfigValue(BASE_CONFIG, 'session.nonexistent')).toBeUndefined()
  })

  it('returns undefined for a deeply missing key', () => {
    expect(getConfigValue(BASE_CONFIG, 'a.b.c.d')).toBeUndefined()
  })

  it('returns the whole nested object for a partial path', () => {
    expect(getConfigValue(BASE_CONFIG, 'session')).toEqual(BASE_CONFIG.session)
  })
})

describe('setConfigValue', () => {
  it('sets a nested string value', () => {
    const result = setConfigValue(BASE_CONFIG, 'integrations.webhook', 'https://example.com/hook')
    expect(result.integrations?.webhook).toBe('https://example.com/hook')
  })

  it('coerces numeric strings to numbers', () => {
    const result = setConfigValue(BASE_CONFIG, 'session.idleTimeout', '60')
    expect(result.session.idleTimeout).toBe(60)
    expect(typeof result.session.idleTimeout).toBe('number')
  })

  it('coerces "true" to boolean true', () => {
    const result = setConfigValue(BASE_CONFIG, 'git.qualifyRepoName', 'true')
    expect(result.git.qualifyRepoName).toBe(true)
  })

  it('coerces "false" to boolean false', () => {
    const config = { ...BASE_CONFIG, git: { qualifyRepoName: true } }
    const result = setConfigValue(config, 'git.qualifyRepoName', 'false')
    expect(result.git.qualifyRepoName).toBe(false)
  })

  it('does not mutate the original config', () => {
    const original = JSON.parse(JSON.stringify(BASE_CONFIG)) as WorkscribeConfig
    setConfigValue(BASE_CONFIG, 'session.idleTimeout', '45')
    expect(BASE_CONFIG.session.idleTimeout).toBe(original.session.idleTimeout)
  })

  it('preserves other keys when setting one value', () => {
    const result = setConfigValue(BASE_CONFIG, 'session.idleTimeout', '45')
    expect(result.capture.ignore).toEqual(['cd', 'ls', 'pwd'])
    expect(result.summary.format).toBe('markdown')
  })

  it('sets summary format', () => {
    const result = setConfigValue(BASE_CONFIG, 'summary.format', 'json')
    expect(result.summary.format).toBe('json')
  })

  it('keeps a URL as a string (not coerced to a number)', () => {
    const result = setConfigValue(BASE_CONFIG, 'integrations.webhook', 'https://api.example.com/v1')
    expect(typeof result.integrations?.webhook).toBe('string')
  })
})
