import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../src/capture/resolvers/aider', () => ({
  resolveAiderPaths: vi.fn().mockReturnValue(['/repo/.aider.chat.history.md']),
}))
vi.mock('../../../src/capture/resolvers/codex', () => ({
  resolveCodexPaths: vi.fn().mockReturnValue(['/home/.codex/sessions/a.jsonl']),
}))
vi.mock('../../../src/capture/resolvers/copilot', () => ({ resolveCopilotPaths: vi.fn().mockReturnValue([]) }))
vi.mock('../../../src/capture/resolvers/amazon-q', () => ({ resolveAmazonQPaths: vi.fn().mockReturnValue([]) }))
vi.mock('../../../src/capture/resolvers/gemini', () => ({ resolveGeminiPaths: vi.fn().mockReturnValue([]) }))
vi.mock('../../../src/capture/resolvers/opencode', () => ({ resolveOpencodePaths: vi.fn().mockReturnValue([]) }))

import { resolveHistoryPaths } from '../../../src/capture/resolvers/index'
import type { AIToolEntry } from '../../../src/config/registry'

function makeEntry(overrides: Partial<AIToolEntry>): AIToolEntry {
  return {
    tool: 'aider',
    displayName: 'Aider',
    pattern: '^aider\\b',
    hook: null,
    contextSource: 'history-file',
    historyFormat: 'markdown',
    securityWarning: null,
    ...overrides,
  }
}

describe('resolveHistoryPaths', () => {
  it('returns empty array for tools with contextSource null', () => {
    const entry = makeEntry({ tool: 'kilo', contextSource: null })
    expect(resolveHistoryPaths(entry, '/repo')).toEqual([])
  })

  it('returns empty array for tools with contextSource hook', () => {
    const entry = makeEntry({ tool: 'claude', contextSource: 'hook', hook: 'claude-code' })
    expect(resolveHistoryPaths(entry, '/repo')).toEqual([])
  })

  it('returns empty array for tools with no registered resolver', () => {
    const entry = makeEntry({ tool: 'unknown-tool', contextSource: 'history-file' })
    expect(resolveHistoryPaths(entry, '/repo')).toEqual([])
  })

  it('dispatches to aider resolver', () => {
    const entry = makeEntry({ tool: 'aider', contextSource: 'history-file' })
    expect(resolveHistoryPaths(entry, '/repo')).toEqual(['/repo/.aider.chat.history.md'])
  })

  it('dispatches to codex resolver', () => {
    const entry = makeEntry({ tool: 'codex', contextSource: 'history-file', historyFormat: 'jsonl' })
    expect(resolveHistoryPaths(entry, '/repo')).toEqual(['/home/.codex/sessions/a.jsonl'])
  })

  it('dispatches to gh copilot resolver', () => {
    const entry = makeEntry({ tool: 'gh copilot', contextSource: 'history-file', historyFormat: 'jsonl' })
    expect(resolveHistoryPaths(entry, '/repo')).toEqual([])
  })
})
