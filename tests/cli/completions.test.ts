import { describe, it, expect } from 'vitest'
import { shouldRunStartupChecks, HIDDEN_COMMANDS } from '../../src/cli/completions'

describe('shouldRunStartupChecks', () => {
  it('returns false for _capture', () => {
    expect(shouldRunStartupChecks('_capture')).toBe(false)
  })

  it('returns false for _hook', () => {
    expect(shouldRunStartupChecks('_hook')).toBe(false)
  })

  it('returns true for a visible command', () => {
    expect(shouldRunStartupChecks('status')).toBe(true)
  })

  it('returns true when no command was given (bare "workscribe")', () => {
    expect(shouldRunStartupChecks(undefined)).toBe(true)
  })

  it('stays in sync with HIDDEN_COMMANDS — every hidden command returns false', () => {
    for (const command of HIDDEN_COMMANDS) {
      expect(shouldRunStartupChecks(command)).toBe(false)
    }
  })
})
