import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/capture', () => ({ captureCommand: vi.fn() }))

import { EventEmitter } from 'events'
import { Command } from 'commander'
import { captureCommand } from '../../src/capture'
import { parseHookPayload, registerHook } from '../../src/cli/hook'

const mockCapture = captureCommand as ReturnType<typeof vi.fn>

// ─── parseHookPayload ─────────────────────────────────────────────────────────

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
    expect(parseHookPayload(JSON.stringify({ cwd: '/some/path' }))).toBeNull()
  })

  it('returns null when tool_input.command is missing', () => {
    expect(parseHookPayload(JSON.stringify({ tool_input: {}, cwd: '/some/path' }))).toBeNull()
  })

  it('returns null when cwd is missing', () => {
    expect(parseHookPayload(JSON.stringify({ tool_input: { command: 'git status' } }))).toBeNull()
  })

  it('returns null when command is not a string', () => {
    expect(parseHookPayload(JSON.stringify({ tool_input: { command: 123 }, cwd: '/some/path' }))).toBeNull()
  })

  it('returns null when cwd is not a string', () => {
    expect(parseHookPayload(JSON.stringify({ tool_input: { command: 'git status' }, cwd: null }))).toBeNull()
  })

  it('handles payloads with extra fields gracefully', () => {
    const payload = JSON.stringify({
      session_id: 'abc-123',
      tool_name: 'Bash',
      tool_input: { command: 'npm test', timeout: 30000 },
      tool_output: { stdout: 'PASS', stderr: '' },
      cwd: '/home/user/app',
    })
    expect(parseHookPayload(payload)).toEqual({ command: 'npm test', cwd: '/home/user/app' })
  })
})

// ─── registerHook integration ─────────────────────────────────────────────────

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerHook(program)
  return program
}

function withStdin(payload: string, fn: () => Promise<void>): Promise<void> {
  const emitter = new EventEmitter() as NodeJS.ReadableStream & EventEmitter
  const original = process.stdin
  Object.defineProperty(process, 'stdin', { value: emitter, writable: true, configurable: true })
  ;(emitter as EventEmitter & { setEncoding: (enc: string) => void }).setEncoding = vi.fn()

  const promise = fn().then(() => {
    Object.defineProperty(process, 'stdin', { value: original, writable: true, configurable: true })
  })

  setImmediate(() => {
    emitter.emit('data', payload)
    emitter.emit('end')
  })

  return promise
}

const VALID_HOOK_PAYLOAD = JSON.stringify({
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'git commit -m "feat: add login"' },
  tool_output: { stdout: '', stderr: '' },
  cwd: '/home/user/myapp',
})

describe('_hook integration', () => {
  it('calls captureCommand with command, cwd, and source from a valid payload', async () => {
    await withStdin(VALID_HOOK_PAYLOAD, async () => {
      await makeProgram().parseAsync(['_hook', '--source', 'claude-code'], { from: 'user' })
      await new Promise((r) => setImmediate(r))
    })
    expect(mockCapture).toHaveBeenCalledOnce()
    expect(mockCapture).toHaveBeenCalledWith({
      command: 'git commit -m "feat: add login"',
      cwd: '/home/user/myapp',
      exitCode: null,
      durationMs: null,
      source: 'claude-code',
    })
  })

  it('calls captureCommand without source when --source is omitted', async () => {
    await withStdin(VALID_HOOK_PAYLOAD, async () => {
      await makeProgram().parseAsync(['_hook'], { from: 'user' })
      await new Promise((r) => setImmediate(r))
    })
    expect(mockCapture).toHaveBeenCalledOnce()
    expect(mockCapture).toHaveBeenCalledWith(expect.objectContaining({ source: undefined }))
  })

  it('does not call captureCommand when payload is empty', async () => {
    await withStdin('', async () => {
      await makeProgram().parseAsync(['_hook'], { from: 'user' })
      await new Promise((r) => setImmediate(r))
    })
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('does not call captureCommand when cwd is missing', async () => {
    await withStdin(JSON.stringify({ tool_input: { command: 'npm test' } }), async () => {
      await makeProgram().parseAsync(['_hook'], { from: 'user' })
      await new Promise((r) => setImmediate(r))
    })
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('does not throw when payload is invalid JSON', async () => {
    await withStdin('not-json', async () => {
      await expect(makeProgram().parseAsync(['_hook'], { from: 'user' })).resolves.not.toThrow()
      await new Promise((r) => setImmediate(r))
    })
    expect(mockCapture).not.toHaveBeenCalled()
  })
})
