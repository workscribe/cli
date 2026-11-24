import { describe, it, expect } from 'vitest'
import {
  applyRetentionSetting,
  DEFAULT_RETENTION,
  isRetentionKey,
  retentionPolicyOf,
  type RetentionConfig,
} from '../../src/config/retention'

const CURRENT: RetentionConfig = { days: 100, keepForever: false, summaryDays: null }

describe('applyRetentionSetting', () => {
  it.each([
    ['retention.days', '30', { ...CURRENT, days: 30 }],
    ['retention.days', '7', { ...CURRENT, days: 7 }],
    ['retention.days', ' 45 ', { ...CURRENT, days: 45 }],
    ['retention.keepForever', 'true', { ...CURRENT, keepForever: true }],
    ['retention.keepForever', 'false', { ...CURRENT, keepForever: false }],
    ['retention.summaryDays', '365', { ...CURRENT, summaryDays: 365 }],
    ['retention.summaryDays', 'none', { ...CURRENT, summaryDays: null }],
  ])('%s %s is accepted', (key, value, expected) => {
    expect(applyRetentionSetting(CURRENT, key, value)).toEqual({ ok: true, retention: expected })
  })

  it.each([
    ['retention.days', ''],
    ['retention.days', '  '],
    ['retention.days', 'null'],
    ['retention.days', 'abc'],
    ['retention.days', '0'],
    ['retention.days', '-30'],
    ['retention.days', '30.5'],
    ['retention.days', '1e2'],
    ['retention.days', '6'],
    ['retention.keepForever', 'yes'],
    ['retention.keepForever', ''],
    ['retention.keepForever', '1'],
    ['retention.summaryDays', ''],
    ['retention.summaryDays', 'null'],
    ['retention.summaryDays', '50'],
    ['retention.summaryDays', '0'],
    ['retention.nothing', '5'],
    ['retention', '5'],
  ])('%s %j is refused, never coerced', (key, value) => {
    expect(applyRetentionSetting(CURRENT, key, value).ok).toBe(false)
  })

  it('refuses a days value that would put the summaries below it, and names the way out', () => {
    const withSummaries = { ...CURRENT, days: 100, summaryDays: 200 }
    const result = applyRetentionSetting(withSummaries, 'retention.days', '300')
    expect(result.ok).toBe(false)
    expect(JSON.stringify(result)).toContain('retention.summaryDays')
  })

  it('leaves the other values as they were', () => {
    const result = applyRetentionSetting({ days: 60, keepForever: true, summaryDays: 90 }, 'retention.days', '70')
    expect(result).toEqual({ ok: true, retention: { days: 70, keepForever: true, summaryDays: 90 } })
  })
})

describe('retentionPolicyOf', () => {
  it('has the defaults when the config does not mention retention', () => {
    expect(retentionPolicyOf({ session: { idleTimeout: 30 } })).toEqual({
      status: 'ok',
      retention: DEFAULT_RETENTION,
      isDefault: true,
    })
  })

  it('fills the values a partial retention block leaves out', () => {
    expect(retentionPolicyOf({ retention: { keepForever: true } })).toEqual({
      status: 'ok',
      retention: { days: 100, keepForever: true, summaryDays: null },
      isDefault: false,
    })
  })

  it.each([
    ['not an object', 'x'],
    ['an array', []],
    ['null', null],
  ])('cannot be trusted when the config file is %s', (_name, parsed) => {
    expect(retentionPolicyOf(parsed).status).toBe('unreadable')
  })

  it.each([
    ['a string', 'forever'],
    ['null', null],
    ['an array', [1]],
    ['a number', 5],
  ])('cannot be trusted when retention is %s: deepMerge would have replaced the whole block', (_name, retention) => {
    expect(retentionPolicyOf({ retention }).status).toBe('unreadable')
  })

  it.each([
    ['days below the minimum', { days: 3 }],
    ['days as text', { days: '100' }],
    ['days with a fraction', { days: 99.5 }],
    ['keepForever as text', { keepForever: 'false' }],
    ['keepForever as a number', { keepForever: 0 }],
    ['summaryDays below days', { days: 100, summaryDays: 50 }],
    ['summaryDays as text', { summaryDays: 'none' }],
  ])('cannot be trusted with %s', (_name, retention) => {
    expect(retentionPolicyOf({ retention }).status).toBe('unreadable')
  })
})

describe('isRetentionKey', () => {
  it.each(['retention', 'retention.days', 'retention.keepForever'])('%s', (key) => {
    expect(isRetentionKey(key)).toBe(true)
  })

  it.each(['retentions', 'capture.retention', 'session.idleTimeout'])('is not %s', (key) => {
    expect(isRetentionKey(key)).toBe(false)
  })
})
