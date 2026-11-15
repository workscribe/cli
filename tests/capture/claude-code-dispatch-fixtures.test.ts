import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { parseClaudeHook } from '../../src/capture/hooks/claude-code-payload'

// Claude Code's recorded payloads, read through the integration the dispatcher calls: the shared shape holds what
// the old Claude-only handler stored, and nothing else
const FIXTURES = join(__dirname, '..', 'fixtures', 'agent-hooks', 'claude-code', '2.1.319')
const BASH = join(__dirname, '..', 'fixtures', 'claude-code-hooks')
const read = (folder: string, name: string) => readFileSync(join(folder, name), 'utf8')

describe('parseClaudeHook over the recorded payloads', () => {
  it.each(['edit.json', 'edit-replace-all.json', 'write-new-file.json', 'notebook-edit-replace.json'])(
    'reads %s as an edit with its file and counts, never its text',
    (name) => {
      const event = parseClaudeHook(read(FIXTURES, name), 'PostToolUse')

      expect(event).toMatchObject({ kind: 'edit', file: expect.any(String), cwd: expect.any(String) })
      expect(JSON.stringify(event)).not.toMatch(/new_string|old_string|content/)
    }
  )

  it("reads Stop and PostCompact as the agent's words, and SessionEnd as how the session ended", () => {
    expect(parseClaudeHook(read(FIXTURES, 'stop.json'), 'Stop')).toMatchObject({
      kind: 'message',
      messageKind: 'recap',
    })
    expect(parseClaudeHook(read(FIXTURES, 'post-compact.json'), 'PostCompact')).toMatchObject({
      kind: 'message',
      messageKind: 'compactSummary',
    })
    expect(parseClaudeHook(read(FIXTURES, 'session-end.json'), 'SessionEnd')).toMatchObject({
      kind: 'session-end',
      reason: 'other',
    })
  })

  it('reads every Bash payload as a command with the outcome the event implies', () => {
    for (const name of readdirSync(BASH).filter((file) => file.startsWith('post-tool-use'))) {
      const event = parseClaudeHook(read(BASH, name), 'PostToolUse')

      expect(event, name).toMatchObject({ kind: 'command', outcome: { kind: 'exit', code: 0 } })
    }
  })

  it.each([
    ['post-tool-use-failure-exit-1.json', 1],
    ['post-tool-use-failure-exit-3.json', 3],
  ])('reads the failure %s with the real exit code', (name, code) => {
    expect(parseClaudeHook(read(BASH, name), 'PostToolUseFailure')).toMatchObject({
      kind: 'command',
      outcome: { kind: 'exit', code },
    })
  })

  it('drops a payload it has no event for, an event it does not handle, and an edit that failed', () => {
    expect(parseClaudeHook('', 'PostToolUse')).toBeNull()
    expect(parseClaudeHook('{}', 'PostToolUse')).toBeNull()
    expect(parseClaudeHook(read(FIXTURES, 'stop.json'), 'SomethingNew')).toBeNull()
    expect(parseClaudeHook(read(FIXTURES, 'edit.json'), 'PostToolUseFailure')).toBeNull()
  })

  it('throws on invalid JSON, which the dispatcher catches', () => {
    expect(() => parseClaudeHook('not-json', 'PostToolUse')).toThrow()
  })
})
