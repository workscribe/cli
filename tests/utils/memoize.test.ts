import { describe, it, expect, vi } from 'vitest'
import { memoize } from '../../src/utils/memoize'

describe('memoize', () => {
  it('runs the lookup once per key', () => {
    const lookup = vi.fn((key: string) => key.length)
    const cached = memoize(lookup)

    expect([cached('ab'), cached('ab'), cached('abc')]).toEqual([2, 2, 3])
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('caches null results too', () => {
    const lookup = vi.fn(() => null)
    const cached = memoize(lookup)

    cached('repo')
    cached('repo')

    expect(lookup).toHaveBeenCalledTimes(1)
  })
})
