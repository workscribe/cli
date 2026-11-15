import fs, { readFileSync } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/capture', () => ({ captureCommand: vi.fn() }))
vi.mock('../../src/config', () => ({ readConfig: vi.fn() }))
vi.mock('../../src/db', () => ({ recordAgentSessionEnding: vi.fn(), recordAgentSessionMessage: vi.fn() }))

import { Command } from 'commander'
import { captureCommand } from '../../src/capture'
import { readConfig } from '../../src/config'
import { recordAgentSessionEnding, recordAgentSessionMessage } from '../../src/db'
import { registerHook } from '../../src/cli/hook'
import { AGENT_MESSAGE_MAX_CHARS } from '../../src/capture/agent-messages'
import { createTestConfig } from '../helpers/config'

const FIXTURES = join(__dirname, '..', 'fixtures', 'agent-hooks', 'claude-code', '2.1.319')
const SESSION = { source: 'claude-code', sessionId: '<session_id>' }
// A token the built-in redaction recognises, so the secret check flags the message holding it
const GITHUB_TOKEN = `ghp_${'a1B2c3D4e5'.repeat(4)}`

const mockCapture = vi.mocked(captureCommand)
const mockReadConfig = vi.mocked(readConfig)
const mockEnding = vi.mocked(recordAgentSessionEnding)
const mockMessage = vi.mocked(recordAgentSessionMessage)

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.json`), 'utf8')
}

function withMessage(name: string, field: string, text: string): string {
  return JSON.stringify({ ...JSON.parse(fixture(name)), [field]: text })
}

function configWith(capture: Partial<ReturnType<typeof createTestConfig>['capture']>) {
  const config = createTestConfig()
  return { ...config, capture: { ...config.capture, ...capture } }
}

/** Runs `_hook` on a payload as Claude Code would: arguments, then the JSON on stdin. */
async function runHook(payload: string, event: string): Promise<void> {
  const stdin = new EventEmitter() as EventEmitter & { setEncoding: () => void }
  stdin.setEncoding = vi.fn()
  const original = process.stdin
  Object.defineProperty(process, 'stdin', { value: stdin, configurable: true })
  try {
    const program = new Command()
    program.exitOverride()
    registerHook(program)
    await program.parseAsync(['_hook', '--source', 'claude-code', '--event', event], { from: 'user' })
    stdin.emit('data', payload)
    stdin.emit('end')
  } finally {
    Object.defineProperty(process, 'stdin', { value: original, configurable: true })
  }
}

beforeEach(() => {
  mockReadConfig.mockReturnValue(createTestConfig())
  vi.spyOn(fs, 'existsSync').mockReturnValue(false)
})

describe('_hook — agent edits', () => {
  it('stores an edit as a code_edit with its line counts and conversation', async () => {
    await runHook(fixture('edit'), 'PostToolUse')

    expect(mockCapture).toHaveBeenCalledWith({
      cwd: '/Users/dev/api',
      exitCode: null,
      durationMs: null,
      type: 'code_edit',
      file: '/Users/dev/api/notes.txt',
      source: 'claude-code',
      linesAdded: 2,
      linesRemoved: 1,
      agentSession: SESSION,
      overlaps: {},
    })
  })

  it('stores nothing with capture.agentEdits or capture.aiTools off', async () => {
    mockReadConfig.mockReturnValue(configWith({ agentEdits: false }))
    await runHook(fixture('write-new-file'), 'PostToolUse')
    mockReadConfig.mockReturnValue(configWith({ aiTools: false }))
    await runHook(fixture('write-new-file'), 'PostToolUse')

    expect(mockCapture).not.toHaveBeenCalled()
  })

  it('records nothing for an edit reported as a failure', async () => {
    await runHook(fixture('edit'), 'PostToolUseFailure')

    expect(mockCapture).not.toHaveBeenCalled()
  })
})

describe('_hook — how a session ends', () => {
  it('records when and why it ended', async () => {
    await runHook(fixture('session-end'), 'SessionEnd')

    expect(mockEnding).toHaveBeenCalledWith({ ...SESSION, endedAt: expect.any(String), reason: 'other' })
  })

  it('records nothing while Workscribe is paused or AI capture is off', async () => {
    vi.spyOn(fs, 'existsSync').mockReturnValue(true)
    await runHook(fixture('session-end'), 'SessionEnd')
    await runHook(fixture('stop'), 'Stop')
    vi.spyOn(fs, 'existsSync').mockReturnValue(false)
    mockReadConfig.mockReturnValue(configWith({ aiTools: false, agentMessages: true }))
    await runHook(fixture('session-end'), 'SessionEnd')

    expect(mockEnding).not.toHaveBeenCalled()
    expect(mockMessage).not.toHaveBeenCalled()
  })
})

describe('_hook — the agent’s own words', () => {
  it('keeps no recap or compaction summary by default', async () => {
    await runHook(fixture('stop'), 'Stop')
    await runHook(fixture('post-compact'), 'PostCompact')

    expect(mockMessage).not.toHaveBeenCalled()
  })

  it('keeps the recap and the compaction summary, capped, when capture.agentMessages is on', async () => {
    mockReadConfig.mockReturnValue(configWith({ agentMessages: true }))
    await runHook(fixture('stop'), 'Stop')
    await runHook(fixture('post-compact'), 'PostCompact')

    expect(mockMessage).toHaveBeenCalledWith({
      ...SESSION,
      kind: 'recap',
      text: expect.stringContaining('I made changes 1–6'),
    })
    const summary = mockMessage.mock.calls[1][0]
    expect(summary).toMatchObject({ kind: 'compactSummary' })
    expect(summary.text).toHaveLength(AGENT_MESSAGE_MAX_CHARS)
  })

  it('drops a recap the secret check flags, rather than storing part of it', async () => {
    mockReadConfig.mockReturnValue(configWith({ agentMessages: true }))
    await runHook(withMessage('stop', 'last_assistant_message', `Set the token to ${GITHUB_TOKEN}`), 'Stop')

    expect(mockMessage).not.toHaveBeenCalled()
  })

  it("applies the user's own redaction patterns", async () => {
    const config = configWith({ agentMessages: true })
    mockReadConfig.mockReturnValue({ ...config, redact: { extra: ['internal-[a-z]+'] } })
    await runHook(withMessage('stop', 'last_assistant_message', 'Deployed to internal-staging'), 'Stop')

    expect(mockMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'Deployed to [REDACTED]' }))
  })
})
