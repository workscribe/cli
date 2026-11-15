import { describe, it, expect } from 'vitest'
import { exitBadge } from '../../src/cli/exit-badge'

describe('exitBadge', () => {
  it('marks a failure with its code, and a failure with no code known as failed', () => {
    expect(exitBadge(2)).toContain('✗2')
    expect(exitBadge(-1)).toContain('✗ failed')
    expect(exitBadge(-1)).not.toContain('-1')
  })

  it('marks nothing for a pass or an unknown outcome', () => {
    expect(exitBadge(0)).toBe('')
    expect(exitBadge(null)).toBe('')
  })
})
