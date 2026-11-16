import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// The real Antigravity integration, so `dispatch.test.ts` (which mocks the integrations) can't cover it
vi.mock('../../src/capture', () => ({ captureCommand: vi.fn() }))
vi.mock('../../src/config', () => ({ readConfig: vi.fn() }))
vi.mock('../../src/db/alerts', () => ({ insertAlert: vi.fn() }))
vi.mock('../../src/db', () => ({ recordAgentSessionEnding: vi.fn(), recordAgentSessionMessage: vi.fn() }))

import { captureCommand } from '../../src/capture'
import { readConfig } from '../../src/config'
import { dispatchHook } from '../../src/capture/hooks/dispatch'

const FIXTURES = join(__dirname, '..', 'fixtures', 'agent-hooks', 'antigravity', '1.5.0')
const read = (name: string) => readFileSync(join(FIXTURES, name), 'utf8')

function config(capture: Record<string, unknown> = {}) {
  vi.mocked(readConfig).mockReturnValue({ capture: { aiTools: true, ...capture }, redact: { extra: [] } } as never)
}

beforeEach(() => config())

describe('dispatchHook for Antigravity', () => {
  it('stores a command under its source and conversation, and asks for the commit check', () => {
    dispatchHook(read('commit-rejected.json'), 'PostToolUse', 'antigravity')

    expect(captureCommand).toHaveBeenCalledWith({
      command: 'git add -A && git commit -m "feat: probe rejected"',
      cwd: '/Users/dev/api',
      exitCode: null,
      durationMs: null,
      source: 'antigravity',
      agentSession: { source: 'antigravity', sessionId: expect.any(String) },
      overlaps: {},
      verifyCommit: true,
    })
  })

  it('stores a file edit as a code_edit of its conversation, with line counts and no text', () => {
    dispatchHook(read('edit-file-multi-line.json'), 'PostToolUse', 'antigravity')

    expect(captureCommand).toHaveBeenCalledWith({
      cwd: '/Users/dev/api',
      exitCode: null,
      durationMs: null,
      type: 'code_edit',
      file: '/Users/dev/api/multi.txt',
      source: 'antigravity',
      linesAdded: 3,
      linesRemoved: 3,
      agentSession: { source: 'antigravity', sessionId: expect.any(String) },
      overlaps: {},
    })
  })

  it('stores no edit with capture.agentEdits off, and nothing with capture.aiTools off', () => {
    config({ agentEdits: false })
    dispatchHook(read('edit-file.json'), 'PostToolUse', 'antigravity')
    config({ aiTools: false })
    dispatchHook(read('command-success.json'), 'PostToolUse', 'antigravity')

    expect(captureCommand).not.toHaveBeenCalled()
  })

  it('drops a payload it cannot read, without throwing', () => {
    expect(() => dispatchHook('not-json', 'PostToolUse', 'antigravity')).not.toThrow()
    expect(captureCommand).not.toHaveBeenCalled()
  })
})
