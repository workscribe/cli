import { describe, it, expect } from 'vitest'
import { formatSessionHeading, formatSessionLabel } from '../../src/summary/heading'

const SESSION = { project: 'api', branch: 'main', durationMinutes: 90 }

describe('formatSessionHeading', () => {
  it('names every branch the session touched, in the order first seen', () => {
    expect(formatSessionHeading({ ...SESSION, branches: ['feat/auth', 'main'] })).toBe(
      '## api (feat/auth, main) — 1h 30m'
    )
  })

  it('names the one branch when that is all the session touched', () => {
    expect(formatSessionHeading({ ...SESSION, branches: ['main'] })).toBe('## api (main) — 1h 30m')
  })

  it('falls back to the branch when the branches are not known', () => {
    expect(formatSessionLabel(SESSION)).toBe('api (main) — 1h 30m')
  })

  it('names no branch outside a repo, and an unknown location as such', () => {
    expect(formatSessionLabel({ project: null, branch: null, branches: [], durationMinutes: 5 })).toBe('unknown — 5m')
  })
})
