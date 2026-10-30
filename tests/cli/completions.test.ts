import { describe, it, expect } from 'vitest'
import { shouldRunStartupChecks, shouldRunDataJobs, HIDDEN_COMMANDS } from '../../src/cli/completions'

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

describe('shouldRunDataJobs', () => {
  it.each(['status', 'summary', 'week', 'export', 'events', 'upgrade'])('runs data jobs before %s', (command) => {
    expect(shouldRunDataJobs([command])).toBe(true)
  })

  it.each([
    '_capture',
    '_hook',
    'context',
    'sessions',
    'init',
    'uninstall',
    'clear',
    'config',
    'pause',
    'skill',
    'completions',
    'help',
  ])('never runs data jobs before %s', (command) => {
    expect(shouldRunDataJobs([command])).toBe(false)
  })

  it('never runs data jobs for a bare "workscribe"', () => {
    expect(shouldRunDataJobs([])).toBe(false)
  })

  it.each(['--version', '-V', '--help', '-h'])('never runs data jobs for %s, alone or after a data command', (flag) => {
    expect(shouldRunDataJobs([flag])).toBe(false)
    expect(shouldRunDataJobs(['summary', flag])).toBe(false)
  })

  it('runs data jobs for a data command with its own options', () => {
    expect(shouldRunDataJobs(['summary', '--date', '2026-10-28'])).toBe(true)
  })
})
