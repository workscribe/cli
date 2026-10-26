import { describe, it, expect } from 'vitest'
import {
  describeInstallFailure,
  describeInstallOutcome,
  describeSkillStatus,
  describeUninstallFailure,
  displayPath,
} from '../../src/skills/report'

describe('displayPath', () => {
  it('shortens paths under home to ~', () => {
    expect(displayPath('/Users/dev/.claude/skills/workscribe', '/Users/dev')).toBe('~/.claude/skills/workscribe')
    expect(displayPath('/opt/skills', '/Users/dev')).toBe('/opt/skills')
  })
})

describe('describeInstallOutcome', () => {
  const base = { agents: 'Codex and GitHub Copilot', location: '~/.agents/skills/workscribe', version: '2.0.0' }

  it.each([
    [
      'installed',
      'success',
      'Installed the Workscribe skill for Codex and GitHub Copilot (~/.agents/skills/workscribe)',
    ],
    ['updated', 'success', 'Updated the Workscribe skill for Codex and GitHub Copilot to 2.0.0'],
    ['up-to-date', 'info', 'The Workscribe skill is already up to date for Codex and GitHub Copilot'],
  ] as const)('%s → %s', (outcome, level, text) => {
    expect(describeInstallOutcome({ ...base, outcome })).toEqual({ level, text })
  })

  it('tells the user how to replace a skill Workscribe did not install', () => {
    expect(describeInstallOutcome({ ...base, outcome: 'skipped-not-ours' }).text).toContain('--force')
  })
})

describe('describeSkillStatus', () => {
  it('names the fix for every state that needs one', () => {
    expect(describeSkillStatus({ kind: 'installed', version: '2.0.0' }, '2.0.0').text).toBe('installed (2.0.0)')
    expect(describeSkillStatus({ kind: 'not-installed' }, '2.0.0').text).toContain('workscribe skill install')
    expect(describeSkillStatus({ kind: 'outdated', version: '1.9.0' }, '2.0.0').text).toContain('this CLI is 2.0.0')
    expect(describeSkillStatus({ kind: 'not-ours' }, '2.0.0').text).toContain('--force')
  })
})

describe('failure messages', () => {
  const target = { agents: 'Claude Code', location: '~/.claude/skills/workscribe' }

  it('gives the reason and the command to retry an install', () => {
    expect(describeInstallFailure({ ...target, error: new Error('EACCES: permission denied') })).toEqual({
      level: 'warn',
      text:
        "Couldn't install the Workscribe skill for Claude Code (EACCES: permission denied). " +
        'Check you can write to ~/.claude/skills/workscribe, then run: workscribe skill install',
    })
  })

  it('gives the reason and a copy-paste way to remove it by hand', () => {
    expect(describeUninstallFailure({ ...target, error: 'busy' }).text).toBe(
      "Couldn't remove the Workscribe skill for Claude Code (busy). Delete it yourself: rm -rf ~/.claude/skills/workscribe"
    )
  })
})
