import { describe, it, expect } from 'vitest'
import { latestRecapOf, shortRecap } from '../../../../src/ai/engines/template/recap'

const agentSession = (id: number, lastSeenAt: string, recap: string | null) => ({
  id,
  source: 'claude-code',
  lastSeenAt,
  recap,
})

describe('shortRecap', () => {
  it('keeps the first sentence, without its full stop', () => {
    expect(shortRecap('Added branch-move reading. Tests pass.')).toBe('Added branch-move reading')
  })

  it('does not end the sentence at an abbreviation', () => {
    expect(shortRecap('Fixed the parser, e.g. the quote handling. Tests pass.')).toBe(
      'Fixed the parser, e.g. the quote handling'
    )
  })

  it.each([
    ['## Summary\nAdded reading', 'Summary'],
    ['- Added reading', 'Added reading'],
    ['\n\n1. Added reading', 'Added reading'],
  ])('drops the markdown marker of %j', (recap, expected) => {
    expect(shortRecap(recap)).toBe(expected)
  })

  it('keeps only the first line', () => {
    expect(shortRecap('Fixed the bug\n- changed a.ts')).toBe('Fixed the bug')
  })

  it('cuts a long recap with an ellipsis', () => {
    const short = shortRecap('x'.repeat(300))

    expect(short).toHaveLength(100)
    expect(short.endsWith('…')).toBe(true)
  })
})

describe('latestRecapOf', () => {
  it('takes the recap of the session seen last', () => {
    const sessions = [agentSession(1, '2026-10-20T09:00:00Z', 'old'), agentSession(2, '2026-10-20T10:00:00Z', 'new')]

    expect(latestRecapOf(sessions)).toBe('new')
  })

  it('skips sessions with no recap', () => {
    const sessions = [agentSession(1, '2026-10-20T09:00:00Z', 'kept'), agentSession(2, '2026-10-20T10:00:00Z', null)]

    expect(latestRecapOf(sessions)).toBe('kept')
  })

  it('is null with no recap at all', () => {
    expect(latestRecapOf([agentSession(1, '2026-10-20T09:00:00Z', null)])).toBeNull()
  })
})
