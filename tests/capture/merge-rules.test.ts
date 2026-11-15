import { describe, it, expect } from 'vitest'
import {
  canMergeAcrossSources,
  isImportedHookPair,
  isInsideFolder,
  isSameCommand,
  isWithin,
  mergedExitCode,
  type EventMerge,
} from '../../src/capture/merge-rules'

describe('isInsideFolder', () => {
  it.each([
    ['/code/app', '/code/app', true],
    ['/code/app/sub', '/code/app', true],
    ['/code/app/sub', '/code/app/', true],
    ['/code/application', '/code/app', false],
    ['/code', '/code/app', false],
  ])('%s inside %s is %s', (folder, parent, expected) => {
    expect(isInsideFolder(folder, parent)).toBe(expected)
  })
})

describe('isWithin', () => {
  const AT = '2026-11-15T10:00:00.000Z'

  it('is true for times less than the window apart, in either order', () => {
    expect(isWithin(AT, '2026-11-15T10:00:00.900Z', 1000)).toBe(true)
    expect(isWithin('2026-11-15T10:00:00.900Z', AT, 1000)).toBe(true)
  })

  it('is false at exactly the window, and beyond it', () => {
    expect(isWithin(AT, '2026-11-15T10:00:01.000Z', 1000)).toBe(false)
    expect(isWithin(AT, '2026-11-15T10:01:00.000Z', 1000)).toBe(false)
  })

  it('is false for a time that is not a date', () => {
    expect(isWithin(AT, 'not a time', 1000)).toBe(false)
  })
})

describe('isSameCommand', () => {
  it("ignores a shell row's leading space and any collapsed whitespace", () => {
    expect(isSameCommand(' npm  test ', 'npm test')).toBe(true)
  })

  it('compares a multi-line command by its collapsed form', () => {
    expect(isSameCommand('git commit -F - <<EOF\nEOF', 'git commit -F - <<EOF EOF')).toBe(true)
  })

  it('tells different commands apart', () => {
    expect(isSameCommand('npm test', 'npm run build')).toBe(false)
  })
})

describe('isImportedHookPair', () => {
  const AGENTS = ['claude-code', 'cursor', 'copilot-vscode']

  it.each([
    ['claude-code', 'cursor', true],
    ['cursor', 'claude-code', true],
    ['cursor', 'copilot-vscode', false],
    ['claude-code', 'claude-code', false],
    ['claude-code', null, false],
    [null, 'claude-code', false],
  ])('%s and %s is %s', (first, second, expected) => {
    expect(isImportedHookPair(first, second, AGENTS)).toBe(expected)
  })

  it('never pairs the imported hook with an editor, which is no agent', () => {
    expect(isImportedHookPair('claude-code', 'vscode', AGENTS)).toBe(false)
  })
})

describe('mergedExitCode', () => {
  it("keeps the survivor's real code", () => {
    expect(mergedExitCode(1, 0)).toBe(1)
  })

  it('takes the other real code when the survivor has none or only a failure marker', () => {
    expect(mergedExitCode(null, 3)).toBe(3)
    expect(mergedExitCode(-1, 3)).toBe(3)
  })

  it('never clears a code with an unknown one', () => {
    expect(mergedExitCode(-1, null)).toBe(-1)
    expect(mergedExitCode(null, -1)).toBeNull()
  })
})

const AGENTS = ['claude-code', 'cursor', 'copilot-vscode']

describe('canMergeAcrossSources', () => {
  const shell: EventMerge = { kind: 'shell-command', agentSources: ['copilot-vscode'] }
  const agent: EventMerge = { kind: 'agent-command', sharesShell: true, agentSources: AGENTS }

  it('lets a shell row merge into the row of an agent that shares the shell hook', () => {
    expect(canMergeAcrossSources(shell, null, 'copilot-vscode')).toBe(true)
    expect(canMergeAcrossSources(shell, null, 'cursor')).toBe(false)
  })

  it("lets an agent's command merge into a shell row only for an agent that shares the shell hook", () => {
    expect(canMergeAcrossSources(agent, 'copilot-vscode', null)).toBe(true)
    expect(
      canMergeAcrossSources({ kind: 'agent-command', sharesShell: false, agentSources: AGENTS }, 'cursor', null)
    ).toBe(false)
  })

  it('lets the imported hook and another agent merge whatever they share', () => {
    expect(
      canMergeAcrossSources(
        { kind: 'agent-command', sharesShell: false, agentSources: AGENTS },
        'cursor',
        'claude-code'
      )
    ).toBe(true)
  })

  it('never merges two rows of one source', () => {
    expect(canMergeAcrossSources(agent, 'cursor', 'cursor')).toBe(false)
  })
})
