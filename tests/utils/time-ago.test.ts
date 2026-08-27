import { describe, it, expect } from 'vitest'
import { timeAgo } from '../../src/utils/format'

const BASE_NOW = new Date('2026-08-27T12:00:00Z').getTime()

function ago(offsetMs: number): string {
  return new Date(BASE_NOW - offsetMs).toISOString()
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

describe('timeAgo', () => {
  it('returns "just now" for 0 seconds', () => {
    expect(timeAgo(ago(0), BASE_NOW)).toBe('just now')
  })

  it('returns "just now" for 1 minute', () => {
    expect(timeAgo(ago(MINUTE), BASE_NOW)).toBe('just now')
  })

  it('returns minutes for 5 minutes', () => {
    expect(timeAgo(ago(5 * MINUTE), BASE_NOW)).toBe('5 minutes ago')
  })

  it('returns minutes for 59 minutes', () => {
    expect(timeAgo(ago(59 * MINUTE), BASE_NOW)).toBe('59 minutes ago')
  })

  it('returns "1 hour ago" for exactly 1 hour', () => {
    expect(timeAgo(ago(HOUR), BASE_NOW)).toBe('1 hour ago')
  })

  it('returns plural hours for 2 hours', () => {
    expect(timeAgo(ago(2 * HOUR), BASE_NOW)).toBe('2 hours ago')
  })

  it('returns plural hours for 23 hours', () => {
    expect(timeAgo(ago(23 * HOUR), BASE_NOW)).toBe('23 hours ago')
  })

  it('returns "yesterday" for exactly 1 day', () => {
    expect(timeAgo(ago(DAY), BASE_NOW)).toBe('yesterday')
  })

  it('returns days for 2 days', () => {
    expect(timeAgo(ago(2 * DAY), BASE_NOW)).toBe('2 days ago')
  })

  it('returns days for 30 days', () => {
    expect(timeAgo(ago(30 * DAY), BASE_NOW)).toBe('30 days ago')
  })

  it('uses current time by default (smoke test)', () => {
    const recent = new Date(Date.now() - 10 * MINUTE).toISOString()
    expect(timeAgo(recent)).toBe('10 minutes ago')
  })
})
