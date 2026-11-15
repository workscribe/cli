import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/capture', () => ({ captureCommand: vi.fn() }))

vi.mock('../../src/config', () => ({ readConfig: vi.fn() }))

import { EventEmitter } from 'events'
import { Command } from 'commander'
import { captureCommand } from '../../src/capture'
import { readConfig } from '../../src/config'
import { registerHook } from '../../src/cli/hook'
import { parseHookPayload } from '../../src/capture/hooks/claude-code-payload'

const mockCapture = captureCommand as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>

beforeEach(() => {
  mockReadConfig.mockReturnValue({ capture: { aiTools: true } })
})

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
    // PostToolUse only fires for a successful call, so it means exit 0
    expect(result).toEqual({
      command: 'git commit -m "feat: add login"',
      cwd: '/home/user/projects/myapp',
      exitCode: 0,
      durationMs: null,
      sessionId: null,
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
    expect(parseHookPayload(payload)).toEqual({
      command: 'npm test',
      cwd: '/home/user/app',
      exitCode: 0,
      durationMs: null,
      sessionId: 'abc-123',
    })
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
      await new Promise((resolve) => setImmediate(resolve))
    })
    expect(mockCapture).toHaveBeenCalledOnce()
    expect(mockCapture).toHaveBeenCalledWith({
      command: 'git commit -m "feat: add login"',
      cwd: '/home/user/myapp',
      exitCode: 0,
      durationMs: null,
      source: 'claude-code',
    })
  })

  it('calls captureCommand without source when --source is omitted', async () => {
    await withStdin(VALID_HOOK_PAYLOAD, async () => {
      await makeProgram().parseAsync(['_hook'], { from: 'user' })
      await new Promise((resolve) => setImmediate(resolve))
    })
    expect(mockCapture).toHaveBeenCalledOnce()
    expect(mockCapture).toHaveBeenCalledWith(expect.objectContaining({ source: undefined }))
  })

  it("links the command to the agent's conversation, named by the hook's source", async () => {
    const withSession = JSON.stringify({ ...JSON.parse(VALID_HOOK_PAYLOAD), session_id: 'conversation-1' })
    await withStdin(withSession, async () => {
      await makeProgram().parseAsync(['_hook', '--source', 'claude-code'], { from: 'user' })
      await new Promise((resolve) => setImmediate(resolve))
    })

    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'claude-code',
        agentSession: { source: 'claude-code', sessionId: 'conversation-1' },
      })
    )
    expect(mockCapture.mock.calls[0][0]).not.toHaveProperty('sessionId')
  })

  it('links no conversation without a --source, so an event and its session never disagree', async () => {
    const withSession = JSON.stringify({ ...JSON.parse(VALID_HOOK_PAYLOAD), session_id: 'conversation-1' })
    await withStdin(withSession, async () => {
      await makeProgram().parseAsync(['_hook'], { from: 'user' })
      await new Promise((resolve) => setImmediate(resolve))
    })

    expect(mockCapture.mock.calls[0][0].agentSession).toBeUndefined()
  })

  it('does not call captureCommand when payload is empty', async () => {
    await withStdin('', async () => {
      await makeProgram().parseAsync(['_hook'], { from: 'user' })
      await new Promise((resolve) => setImmediate(resolve))
    })
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('does not call captureCommand when cwd is missing', async () => {
    await withStdin(JSON.stringify({ tool_input: { command: 'npm test' } }), async () => {
      await makeProgram().parseAsync(['_hook'], { from: 'user' })
      await new Promise((resolve) => setImmediate(resolve))
    })
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('does not throw when payload is invalid JSON', async () => {
    await withStdin('not-json', async () => {
      await expect(makeProgram().parseAsync(['_hook'], { from: 'user' })).resolves.not.toThrow()
      await new Promise((resolve) => setImmediate(resolve))
    })
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('does not call captureCommand when capture.aiTools is false', async () => {
    mockReadConfig.mockReturnValue({ capture: { aiTools: false } })
    await withStdin(VALID_HOOK_PAYLOAD, async () => {
      await makeProgram().parseAsync(['_hook', '--source', 'claude-code'], { from: 'user' })
      await new Promise((resolve) => setImmediate(resolve))
    })
    expect(mockCapture).not.toHaveBeenCalled()
  })
})

// WOR-127: payloads recorded from Claude Code 2.1.311 (paths and ids replaced) — a success fires only PostToolUse,
// a failure only PostToolUseFailure, whose `error` starts with the exit code
describe('parseHookPayload — recorded Claude Code payloads', () => {
  const fixture = (name: string) =>
    readFileSync(join(__dirname, '../fixtures/claude-code-hooks', `${name}.json`), 'utf-8')

  it('a successful command (PostToolUse) is exit 0, with its duration', () => {
    expect(parseHookPayload(fixture('post-tool-use-success'), 'PostToolUse')).toEqual({
      command: 'true',
      cwd: '/Users/dev/api',
      exitCode: 0,
      durationMs: 1381,
      sessionId: '<session_id>',
    })
  })

  it('has no session id when the payload has none, or an empty one', () => {
    const payload = (sessionId: unknown) =>
      JSON.stringify({ tool_name: 'Bash', tool_input: { command: 'ls' }, cwd: '/repo', session_id: sessionId })

    expect(parseHookPayload(payload(''))?.sessionId).toBeNull()
    expect(parseHookPayload(payload(42))?.sessionId).toBeNull()
    expect(parseHookPayload(payload(undefined))?.sessionId).toBeNull()
  })

  it.each([
    ['post-tool-use-failure-exit-1', 1],
    ['post-tool-use-failure-exit-3', 3],
  ])('%s gives its real exit code', (name, exitCode) => {
    expect(parseHookPayload(fixture(name), 'PostToolUseFailure')?.exitCode).toBe(exitCode)
  })

  it('reports cwd as where the shell ended up: a cd inside the project is kept, one leaving it is reset', () => {
    expect(parseHookPayload(fixture('post-tool-use-cd-in-project'), 'PostToolUse')).toMatchObject({
      command: 'cd sub && true',
      cwd: '/Users/dev/api/sub',
    })
    expect(parseHookPayload(fixture('post-tool-use-cd-success'), 'PostToolUse')).toMatchObject({
      command: 'cd /tmp && true',
      cwd: '/Users/dev/api',
    })
  })

  it('ignores a tool other than Bash, should the settings matcher ever be widened', () => {
    const edit = JSON.stringify({ ...JSON.parse(fixture('post-tool-use-success')), tool_name: 'Edit' })
    expect(parseHookPayload(edit, 'PostToolUse')).toBeNull()
  })

  it('an interrupted call has an unknown outcome', () => {
    const interrupted = JSON.stringify({
      ...JSON.parse(fixture('post-tool-use-failure-exit-1')),
      error: 'Interrupted by user',
      is_interrupt: true,
    })
    expect(parseHookPayload(interrupted, 'PostToolUseFailure')?.exitCode).toBeNull()
  })

  it('a failure without an exit code line has an unknown outcome — and only that first line is read', () => {
    const toolError = JSON.stringify({
      ...JSON.parse(fixture('post-tool-use-failure-exit-1')),
      error: 'Command timed out\nsecret output',
    })
    expect(parseHookPayload(toolError, 'PostToolUseFailure')).toMatchObject({ exitCode: null })
  })
})

describe('_hook — events', () => {
  it('captures a PostToolUseFailure with its exit code', async () => {
    const failure = readFileSync(
      join(__dirname, '../fixtures/claude-code-hooks/post-tool-use-failure-exit-3.json'),
      'utf-8'
    )
    await withStdin(failure, async () => {
      await makeProgram().parseAsync(['_hook', '--source', 'claude-code', '--event', 'PostToolUseFailure'], {
        from: 'user',
      })
      await new Promise((resolve) => setImmediate(resolve))
    })
    expect(mockCapture).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'exit 3', exitCode: 3, durationMs: 22 })
    )
  })

  it('ignores an event it does not know, rather than treating it as a command', async () => {
    await withStdin(VALID_HOOK_PAYLOAD, async () => {
      await makeProgram().parseAsync(['_hook', '--source', 'claude-code', '--event', 'SomethingNew'], { from: 'user' })
      await new Promise((resolve) => setImmediate(resolve))
    })
    expect(mockCapture).not.toHaveBeenCalled()
  })
})
