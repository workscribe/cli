import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/capture', () => ({ captureCommand: vi.fn() }))

import { EventEmitter } from 'events'
import { Command } from 'commander'
import { captureCommand } from '../src/capture'
import { registerHook } from '../src/cli/hook'

const mockCapture = captureCommand as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerHook(program)
  return program
}

/** Simulate stdin delivering a payload then closing */
function withStdin(payload: string, fn: () => Promise<void>): Promise<void> {
  const emitter = new EventEmitter() as NodeJS.ReadableStream & EventEmitter
  const original = process.stdin
  Object.defineProperty(process, 'stdin', { value: emitter, writable: true, configurable: true })
  ;(emitter as EventEmitter & { setEncoding: (enc: string) => void }).setEncoding = vi.fn()

  const promise = fn().then(() => {
    Object.defineProperty(process, 'stdin', { value: original, writable: true, configurable: true })
  })

  // Emit data and end after the handler is registered
  setImmediate(() => {
    emitter.emit('data', payload)
    emitter.emit('end')
  })

  return promise
}

const VALID_PAYLOAD = JSON.stringify({
  hook_event_name: 'PostToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'git commit -m "feat: add login"' },
  tool_output: { stdout: '', stderr: '' },
  cwd: '/home/user/myapp',
})

describe('_hook integration', () => {
  it('calls captureCommand with command and cwd from a valid payload', async () => {
    await withStdin(VALID_PAYLOAD, async () => {
      await makeProgram().parseAsync(['_hook', '--source', 'claude-code'], { from: 'user' })
      await new Promise((r) => setImmediate(r))
    })
    expect(mockCapture).toHaveBeenCalledOnce()
    expect(mockCapture).toHaveBeenCalledWith({
      command: 'git commit -m "feat: add login"',
      cwd: '/home/user/myapp',
      exitCode: null,
      durationMs: null,
    })
  })

  it('does not call captureCommand when payload is empty', async () => {
    await withStdin('', async () => {
      await makeProgram().parseAsync(['_hook'], { from: 'user' })
      await new Promise((r) => setImmediate(r))
    })
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('does not call captureCommand when cwd is missing', async () => {
    const payload = JSON.stringify({ tool_input: { command: 'npm test' } })
    await withStdin(payload, async () => {
      await makeProgram().parseAsync(['_hook'], { from: 'user' })
      await new Promise((r) => setImmediate(r))
    })
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('does not call captureCommand when command is missing', async () => {
    const payload = JSON.stringify({ tool_input: {}, cwd: '/some/path' })
    await withStdin(payload, async () => {
      await makeProgram().parseAsync(['_hook'], { from: 'user' })
      await new Promise((r) => setImmediate(r))
    })
    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('does not throw when payload is invalid JSON', async () => {
    await withStdin('not-json', async () => {
      await expect(
        makeProgram().parseAsync(['_hook'], { from: 'user' })
      ).resolves.not.toThrow()
      await new Promise((r) => setImmediate(r))
    })
    expect(mockCapture).not.toHaveBeenCalled()
  })
})
