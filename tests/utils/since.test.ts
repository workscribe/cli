import { describe, it, expect } from 'vitest'
import { parseSince } from '../../src/utils/since'

const NOW = new Date('2026-11-10T12:00:00.000Z')

describe('parseSince', () => {
  it('reads hours, days and weeks back from now', () => {
    expect(parseSince('6h', NOW)).toBe('2026-11-10T06:00:00.000Z')
    expect(parseSince('2d', NOW)).toBe('2026-11-08T12:00:00.000Z')
    expect(parseSince('1w', NOW)).toBe('2026-11-03T12:00:00.000Z')
  })

  it('reads a date as the start of that local day', () => {
    expect(parseSince('2026-11-05', NOW)).toBe(new Date('2026-11-05T00:00:00').toISOString())
  })

  it.each(['', 'yesterday', '0h', '5m', '-2d', '2026-02-31', '2026-11-5', '99999999999999w'])('rejects %j', (input) => {
    expect(() => parseSince(input, NOW)).toThrow(/Invalid --since/)
  })
})
