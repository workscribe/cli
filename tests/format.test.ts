import { describe, it, expect } from 'vitest'
import { startOfWeek, eachDayOfRange } from '../src/utils/format'

describe('startOfWeek', () => {
  it('returns Monday when given a Monday', () => {
    expect(startOfWeek('2026-05-25')).toBe('2026-05-25') // Monday
  })

  it('returns Monday when given a Wednesday', () => {
    expect(startOfWeek('2026-05-27')).toBe('2026-05-25') // Wednesday → Mon
  })

  it('returns Monday when given a Sunday', () => {
    expect(startOfWeek('2026-05-31')).toBe('2026-05-25') // Sunday → Mon of same week
  })

  it('returns Monday when given a Friday', () => {
    expect(startOfWeek('2026-05-29')).toBe('2026-05-25')
  })

  it('handles week crossing a month boundary', () => {
    expect(startOfWeek('2026-06-01')).toBe('2026-06-01') // Monday
  })
})

describe('eachDayOfRange', () => {
  it('returns a single day when start equals end', () => {
    expect(eachDayOfRange('2026-05-25', '2026-05-25')).toEqual(['2026-05-25'])
  })

  it('returns all days inclusive of both endpoints', () => {
    expect(eachDayOfRange('2026-05-25', '2026-05-27')).toEqual([
      '2026-05-25',
      '2026-05-26',
      '2026-05-27',
    ])
  })

  it('returns correct count for a full week', () => {
    const days = eachDayOfRange('2026-05-25', '2026-05-31')
    expect(days).toHaveLength(7)
    expect(days[0]).toBe('2026-05-25')
    expect(days[6]).toBe('2026-05-31')
  })

  it('returns empty array when start is after end', () => {
    expect(eachDayOfRange('2026-05-27', '2026-05-25')).toEqual([])
  })
})
