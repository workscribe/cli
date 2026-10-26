import { describe, it, expect } from 'vitest'
import {
  describeLegacyAiSettings,
  hasLegacyAiSettings,
  isRemovedAiSetting,
  REMOVED_AI_SETTING_MESSAGE,
  withoutLegacyAiSettings,
} from '../../src/summary/legacy-ai'
import { createTestConfig } from '../helpers/config'

describe('hasLegacyAiSettings', () => {
  it('is false for a 2.0 config', () => {
    expect(hasLegacyAiSettings(createTestConfig())).toBe(false)
  })

  it.each(['provider', 'apiKey', 'model', 'baseUrl'])('is true when ai.%s is set', (field) => {
    expect(hasLegacyAiSettings(createTestConfig({ ai: { [field]: 'value' } }))).toBe(true)
  })

  it('ignores an ai block left with empty values', () => {
    expect(hasLegacyAiSettings(createTestConfig({ ai: { provider: '', apiKey: '', model: '', baseUrl: '' } }))).toBe(
      false
    )
  })

  it.each(['ollama', 'provider'])('is true for summary.engine %s', (engine) => {
    expect(hasLegacyAiSettings(createTestConfig({ summary: { format: 'markdown', engine } }))).toBe(true)
  })

  it('is false for summary.engine template, which is what 2.0 does anyway', () => {
    expect(hasLegacyAiSettings(createTestConfig({ summary: { format: 'markdown', engine: 'template' } }))).toBe(false)
  })
})

describe('describeLegacyAiSettings', () => {
  it('is null when nothing is left over', () => {
    expect(describeLegacyAiSettings(createTestConfig(), '~/.config/workscribe/config.json')).toBeNull()
  })

  it('says what changed, and gives the copy-paste commands on their own lines', () => {
    const notice = describeLegacyAiSettings(
      createTestConfig({ ai: { provider: 'anthropic', apiKey: 'sk-old' } }),
      '~/.config/workscribe/config.json'
    )

    expect(notice).toContain('AI providers were removed in Workscribe 2.0')
    expect(notice?.split('\n')).toEqual(expect.arrayContaining(['  workscribe skill install', '  workscribe init']))
  })

  it('names the config file it was given, wherever it lives', () => {
    const notice = describeLegacyAiSettings(
      createTestConfig({ ai: { apiKey: 'sk-old' } }),
      '~/.config/workscribe/config.json'
    )

    expect(notice).toContain('still in ~/.config/workscribe/config.json')
  })
})

describe('isRemovedAiSetting', () => {
  it('matches ai, every ai.* key, summary.engine and anything under it, in any case', () => {
    const keys = [
      'ai',
      'ai.provider',
      'ai.apiKey',
      'AI.apiKey',
      'Ai',
      'summary.engine',
      'Summary.Engine',
      'summary.engine.foo',
    ]
    expect(keys.every(isRemovedAiSetting)).toBe(true)
  })

  it('leaves every other setting alone, including ones that start with "ai"', () => {
    expect(['summary.format', 'capture.aiTools', 'aiTools', 'session.idleTimeout'].some(isRemovedAiSetting)).toBe(false)
  })
})

describe('withoutLegacyAiSettings', () => {
  it('drops ai and summary.engine and keeps everything else, without mutating the input', () => {
    const config = createTestConfig({
      ai: { provider: 'anthropic', apiKey: 'sk-old' },
      summary: { format: 'json', engine: 'provider', includeCategories: ['linting'] },
    })

    const cleaned = withoutLegacyAiSettings(config)

    expect(cleaned).not.toHaveProperty('ai')
    expect(cleaned.summary).toEqual({ format: 'json', includeCategories: ['linting'] })
    expect(cleaned.session).toEqual(config.session)
    expect(config.ai?.apiKey).toBe('sk-old')
  })
})

describe('REMOVED_AI_SETTING_MESSAGE', () => {
  it('ends with the command to run on its own line', () => {
    expect(REMOVED_AI_SETTING_MESSAGE.split('\n').at(-1)).toBe('  workscribe skill install')
  })
})
