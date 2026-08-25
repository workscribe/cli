import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/capture', () => ({ captureCommand: vi.fn() }))
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/utils/logger', () => ({ debugLog: vi.fn() }))
vi.mock('../../src/capture/detect-secrets', () => ({ containsSecrets: vi.fn() }))
vi.mock('../../src/db/alerts', () => ({ insertAlert: vi.fn() }))

import { EventEmitter } from 'events'
import { Command } from 'commander'
import { parseUserPromptPayload, registerHook } from '../../src/cli/hook'
import { containsSecrets } from '../../src/capture/detect-secrets'
import { insertAlert } from '../../src/db/alerts'

const mockContainsSecrets = containsSecrets as ReturnType<typeof vi.fn>
const mockInsertAlert = insertAlert as ReturnType<typeof vi.fn>

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

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── parseUserPromptPayload ────────────────────────────────────────────────────

describe('parseUserPromptPayload', () => {
  it('returns null for empty string', () => {
    expect(parseUserPromptPayload('')).toBeNull()
  })

  it('returns null when prompt field is missing', () => {
    const payload = JSON.stringify({ session_id: 'abc', cwd: '/repo' })
    expect(parseUserPromptPayload(payload)).toBeNull()
  })

  it('parses a valid UserPromptSubmit payload', () => {
    const payload = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-123',
      prompt: 'help me fix this bug',
      cwd: '/repo',
    })
    expect(parseUserPromptPayload(payload)).toEqual({
      session_id: 'sess-123',
      prompt: 'help me fix this bug',
      cwd: '/repo',
    })
  })

  it('uses empty string for session_id when absent', () => {
    const payload = JSON.stringify({ prompt: 'hello', cwd: '/repo' })
    const result = parseUserPromptPayload(payload)
    expect(result?.session_id).toBe('')
  })

  it('handles prompts with extra fields gracefully', () => {
    const payload = JSON.stringify({
      hook_event_name: 'UserPromptSubmit',
      session_id: 'sess-xyz',
      transcript_path: '/tmp/transcript.json',
      prompt: 'add a login form',
      cwd: '/workspace',
    })
    expect(parseUserPromptPayload(payload)).toEqual({
      session_id: 'sess-xyz',
      prompt: 'add a login form',
      cwd: '/workspace',
    })
  })
})

// ─── _hook --event UserPromptSubmit integration ────────────────────────────────

const USER_PROMPT_PAYLOAD_WITH_SECRET = JSON.stringify({
  hook_event_name: 'UserPromptSubmit',
  session_id: 'sess-abc',
  prompt: 'my key is AKIAIOSFODNN7EXAMPLE',
  cwd: '/repo',
})

const USER_PROMPT_PAYLOAD_CLEAN = JSON.stringify({
  hook_event_name: 'UserPromptSubmit',
  session_id: 'sess-abc',
  prompt: 'help me refactor this function',
  cwd: '/repo',
})

describe('_hook --event UserPromptSubmit integration', () => {
  it('calls insertAlert and writes systemMessage when secrets are detected', async () => {
    mockContainsSecrets.mockReturnValue(true)
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await withStdin(USER_PROMPT_PAYLOAD_WITH_SECRET, async () => {
      await makeProgram().parseAsync(['_hook', '--source', 'claude-code', '--event', 'UserPromptSubmit'], {
        from: 'user',
      })
      await new Promise((resolve) => setImmediate(resolve))
    })

    expect(mockInsertAlert).toHaveBeenCalledOnce()
    expect(mockInsertAlert).toHaveBeenCalledWith('claude-code', 'sess-abc', expect.any(String))
    const output = writeSpy.mock.calls.map((call) => call[0] as string).join('')
    expect(output).toContain('systemMessage')
    writeSpy.mockRestore()
  })

  it('does not call insertAlert when no secrets are detected', async () => {
    mockContainsSecrets.mockReturnValue(false)

    await withStdin(USER_PROMPT_PAYLOAD_CLEAN, async () => {
      await makeProgram().parseAsync(['_hook', '--source', 'claude-code', '--event', 'UserPromptSubmit'], {
        from: 'user',
      })
      await new Promise((resolve) => setImmediate(resolve))
    })

    expect(mockInsertAlert).not.toHaveBeenCalled()
  })

  it('does not call insertAlert when payload is empty', async () => {
    await withStdin('', async () => {
      await makeProgram().parseAsync(['_hook', '--source', 'claude-code', '--event', 'UserPromptSubmit'], {
        from: 'user',
      })
      await new Promise((resolve) => setImmediate(resolve))
    })

    expect(mockInsertAlert).not.toHaveBeenCalled()
  })

  it('uses "unknown" as tool when --source is omitted', async () => {
    mockContainsSecrets.mockReturnValue(true)
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

    await withStdin(USER_PROMPT_PAYLOAD_WITH_SECRET, async () => {
      await makeProgram().parseAsync(['_hook', '--event', 'UserPromptSubmit'], { from: 'user' })
      await new Promise((resolve) => setImmediate(resolve))
    })

    expect(mockInsertAlert).toHaveBeenCalledWith('unknown', expect.any(String), expect.any(String))
  })
})
