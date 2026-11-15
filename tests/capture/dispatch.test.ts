import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/capture', () => ({ captureCommand: vi.fn() }))
vi.mock('../../src/config', () => ({ readConfig: vi.fn() }))
vi.mock('../../src/capture/detect-secrets', () => ({ containsSecrets: vi.fn(() => false) }))
vi.mock('../../src/db/alerts', () => ({ insertAlert: vi.fn() }))
vi.mock('../../src/db', () => ({ recordAgentSessionEnding: vi.fn(), recordAgentSessionMessage: vi.fn() }))
vi.mock('fs', () => ({ default: { existsSync: vi.fn(() => false) } }))

// A second agent: it only has to read its own payload into the shared shape
vi.mock('../../src/capture/hooks', () => ({
  AI_HOOK_INTEGRATIONS: {
    'claude-code': { parse: vi.fn(() => null) },
    stub: { parse: vi.fn(), checksCommits: false },
    checked: { parse: vi.fn(), checksCommits: true },
  },
}))

import { AI_HOOK_INTEGRATIONS } from '../../src/capture/hooks'
import { captureCommand } from '../../src/capture'
import { readConfig } from '../../src/config'
import { debugLog } from '../../src/utils/logger'
import { containsSecrets } from '../../src/capture/detect-secrets'
import { insertAlert } from '../../src/db/alerts'
import { recordAgentSessionEnding, recordAgentSessionMessage } from '../../src/db'
import { dispatchHook } from '../../src/capture/hooks/dispatch'
import type { HookEvent } from '../../src/capture/hooks/event'

const parse = (source: string) => vi.mocked(AI_HOOK_INTEGRATIONS[source].parse)

const COMMAND: HookEvent = {
  kind: 'command',
  command: 'npm test',
  cwd: '/code/api',
  outcome: { kind: 'exit', code: 1 },
  durationMs: 40,
  sessionId: 'conversation-1',
}

function config(capture: Record<string, unknown> = {}) {
  vi.mocked(readConfig).mockReturnValue({ capture: { aiTools: true, ...capture }, redact: { extra: [] } } as never)
}

beforeEach(() => {
  config()
  vi.mocked(containsSecrets).mockReturnValue(false)
})

describe('dispatchHook', () => {
  it("stores a command the agent's parser read, under its source and conversation", () => {
    parse('stub').mockReturnValue(COMMAND)

    dispatchHook('{}', 'PostToolUse', 'stub')

    expect(captureCommand).toHaveBeenCalledWith({
      command: 'npm test',
      cwd: '/code/api',
      exitCode: 1,
      durationMs: 40,
      source: 'stub',
      agentSession: { source: 'stub', sessionId: 'conversation-1' },
    })
  })

  it('stores -1 for a command that failed with no code, and null for one with no outcome', () => {
    parse('stub').mockReturnValueOnce({ ...COMMAND, outcome: { kind: 'failed' } })
    dispatchHook('{}', 'PostToolUse', 'stub')
    parse('stub').mockReturnValueOnce({ ...COMMAND, outcome: { kind: 'unknown' } })
    dispatchHook('{}', 'PostToolUse', 'stub')

    expect(vi.mocked(captureCommand).mock.calls.map(([call]) => call.exitCode)).toEqual([-1, null])
  })

  it('asks for the commit check only for an integration that turned it on', () => {
    parse('checked').mockReturnValue(COMMAND)
    parse('stub').mockReturnValue(COMMAND)

    dispatchHook('{}', 'PostToolUse', 'checked')
    dispatchHook('{}', 'PostToolUse', 'stub')

    expect(vi.mocked(captureCommand).mock.calls[0][0]).toMatchObject({ verifyCommit: true })
    expect(vi.mocked(captureCommand).mock.calls[1][0]).not.toHaveProperty('verifyCommit')
  })

  it('drops an unknown source, and a payload the parser has no event for', () => {
    dispatchHook('{}', 'PostToolUse', 'nobody')
    parse('stub').mockReturnValue(null)
    dispatchHook('{}', 'PostToolUse', 'stub')

    expect(captureCommand).not.toHaveBeenCalled()
  })

  it('reads an omitted source as Claude Code, which stores its events with no source', () => {
    parse('claude-code').mockReturnValueOnce({ ...COMMAND, sessionId: null })

    dispatchHook('{}', 'PostToolUse', undefined)

    expect(captureCommand).toHaveBeenCalledWith(expect.objectContaining({ source: undefined }))
  })

  it('never throws on invalid JSON: the parser throws and the event is dropped', () => {
    parse('stub').mockImplementation(() => {
      throw new SyntaxError('Unexpected token')
    })

    expect(() => dispatchHook('not-json', 'PostToolUse', 'stub')).not.toThrow()
    expect(captureCommand).not.toHaveBeenCalled()
    expect(debugLog).toHaveBeenCalled()
  })

  it.each([
    ['a command', COMMAND],
    ['an edit', { kind: 'edit', file: 'a.ts', cwd: '/code', linesAdded: 1, linesRemoved: 0, sessionId: 's' }],
  ] as [string, HookEvent][])('stores nothing for %s with capture.aiTools off', (_name, event) => {
    config({ aiTools: false })
    parse('stub').mockReturnValue(event)

    dispatchHook('{}', 'PostToolUse', 'stub')

    expect(captureCommand).not.toHaveBeenCalled()
  })

  it('stores an edit as a code_edit of its conversation, unless capture.agentEdits is off', () => {
    const edit: HookEvent = { kind: 'edit', file: 'a.ts', cwd: '/code', linesAdded: 3, linesRemoved: 1, sessionId: 's' }
    parse('stub').mockReturnValue(edit)

    dispatchHook('{}', 'PostToolUse', 'stub')
    expect(captureCommand).toHaveBeenCalledWith({
      cwd: '/code',
      exitCode: null,
      durationMs: null,
      type: 'code_edit',
      file: 'a.ts',
      source: 'stub',
      linesAdded: 3,
      linesRemoved: 1,
      agentSession: { source: 'stub', sessionId: 's' },
    })

    vi.mocked(captureCommand).mockClear()
    config({ agentEdits: false })
    dispatchHook('{}', 'PostToolUse', 'stub')
    expect(captureCommand).not.toHaveBeenCalled()
  })

  it('raises an alert for a prompt with a credential in it, even with capture.aiTools off', () => {
    config({ aiTools: false })
    vi.mocked(containsSecrets).mockReturnValue(true)
    parse('stub').mockReturnValue({ kind: 'prompt', text: 'key sk-abc', sessionId: 's' })

    dispatchHook('{}', 'UserPromptSubmit', 'stub')

    expect(insertAlert).toHaveBeenCalledWith('stub', 's', expect.any(String))
  })

  it('records how a session ended, and keeps recaps only with capture.agentMessages on', () => {
    parse('stub').mockReturnValue({ kind: 'session-end', sessionId: 's', reason: 'clear' })
    dispatchHook('{}', 'SessionEnd', 'stub')
    expect(recordAgentSessionEnding).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'stub', sessionId: 's', reason: 'clear' })
    )

    parse('stub').mockReturnValue({ kind: 'message', sessionId: 's', messageKind: 'recap', text: 'Fixed it' })
    dispatchHook('{}', 'Stop', 'stub')
    expect(recordAgentSessionMessage).not.toHaveBeenCalled()

    config({ agentMessages: true })
    dispatchHook('{}', 'Stop', 'stub')
    expect(recordAgentSessionMessage).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'stub', sessionId: 's', kind: 'recap', text: 'Fixed it' })
    )
  })
})
