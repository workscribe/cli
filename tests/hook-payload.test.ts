import { describe, it, expect } from 'vitest'
import { parseHookPayload } from '../src/cli/hook'

const validPayload = JSON.stringify({
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'git commit -m "feat: add login"' },
  tool_output: { stdout: 'main 1234abc', stderr: '' },
  cwd: '/home/user/projects/myapp',
})

describe('parseHookPayload', () => {
  it('parses a valid Claude Code PostToolUse payload', () => {
    const result = parseHookPayload(validPayload)
    expect(result).toEqual({
      command: 'git commit -m "feat: add login"',
      cwd: '/home/user/projects/myapp',
    })
  })

  it('returns null for empty string', () => {
    expect(parseHookPayload('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(parseHookPayload('   \n  ')).toBeNull()
  })

  it('throws on invalid JSON', () => {
    expect(() => parseHookPayload('not-json')).toThrow()
  })

  it('returns null when tool_input is missing', () => {
    const payload = JSON.stringify({ cwd: '/some/path' })
    expect(parseHookPayload(payload)).toBeNull()
  })

  it('returns null when tool_input.command is missing', () => {
    const payload = JSON.stringify({ tool_input: {}, cwd: '/some/path' })
    expect(parseHookPayload(payload)).toBeNull()
  })

  it('returns null when cwd is missing', () => {
    const payload = JSON.stringify({ tool_input: { command: 'git status' } })
    expect(parseHookPayload(payload)).toBeNull()
  })

  it('returns null when command is not a string', () => {
    const payload = JSON.stringify({ tool_input: { command: 123 }, cwd: '/some/path' })
    expect(parseHookPayload(payload)).toBeNull()
  })

  it('returns null when cwd is not a string', () => {
    const payload = JSON.stringify({ tool_input: { command: 'git status' }, cwd: null })
    expect(parseHookPayload(payload)).toBeNull()
  })

  it('handles payloads with extra fields gracefully', () => {
    const payload = JSON.stringify({
      session_id: 'abc-123',
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      tool_input: { command: 'npm test', timeout: 30000 },
      tool_output: { stdout: 'PASS', stderr: '' },
      cwd: '/home/user/app',
      effort: { level: 'high' },
    })
    const result = parseHookPayload(payload)
    expect(result).toEqual({ command: 'npm test', cwd: '/home/user/app' })
  })
})
