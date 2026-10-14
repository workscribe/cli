import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({ default: { existsSync: vi.fn() } }))

vi.mock('../../src/db', () => ({
  insertEvent: vi.fn(),
  getLastEvent: vi.fn(),
  getLastEventForFile: vi.fn(),
  getLastEventForCwd: vi.fn(),
}))

vi.mock('../../src/config', () => ({ readConfig: vi.fn() }))

vi.mock('../../src/normalize/patterns', () => ({ normalizeCommand: vi.fn() }))

vi.mock('../../src/capture/filter', () => ({
  shouldFilter: vi.fn(),
  isDuplicate: vi.fn(),
}))

vi.mock('../../src/capture/redact', () => ({ redact: vi.fn() }))

vi.mock('../../src/capture/git', () => ({ getGitContext: vi.fn() }))

vi.mock('../../src/capture/git-snapshot', () => ({ getCommitsSince: vi.fn() }))

vi.mock('../../src/capture/aider', () => ({ readLastAiderPrompt: vi.fn() }))

vi.mock('../../src/config/registry', () => ({
  loadAIToolRegistry: vi.fn().mockReturnValue([
    { tool: 'claude', pattern: '^claude\\b', hook: 'claude-code', contextSource: 'hook' },
    { tool: 'aider', pattern: '^aider\\b', hook: null, contextSource: 'history-file' },
    { tool: 'gemini', pattern: '^gemini\\b', hook: null, contextSource: null },
  ]),
}))

vi.mock('../../src/utils/paths', () => ({ PAUSE_FLAG_PATH: '/home/user/.workscribe/paused' }))

import fs from 'fs'
import { insertEvent, getLastEvent, getLastEventForCwd } from '../../src/db'
import { readConfig } from '../../src/config'
import { normalizeCommand } from '../../src/normalize/patterns'
import { shouldFilter, isDuplicate } from '../../src/capture/filter'
import { redact } from '../../src/capture/redact'
import { getGitContext } from '../../src/capture/git'
import { readLastAiderPrompt } from '../../src/capture/aider'
import { captureCommand } from '../../src/capture'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockInsertEvent = insertEvent as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockNormalize = normalizeCommand as ReturnType<typeof vi.fn>
const mockShouldFilter = shouldFilter as ReturnType<typeof vi.fn>
const mockIsDuplicate = isDuplicate as ReturnType<typeof vi.fn>
const mockRedact = redact as ReturnType<typeof vi.fn>
const mockGetGitContext = getGitContext as ReturnType<typeof vi.fn>
const mockGetLastEvent = getLastEvent as ReturnType<typeof vi.fn>
const mockGetLastEventForCwd = getLastEventForCwd as ReturnType<typeof vi.fn>
const mockReadLastAiderPrompt = readLastAiderPrompt as ReturnType<typeof vi.fn>

const BASE_CONFIG = {
  capture: { ignore: [], aiTools: true, includeAiderPrompt: true },
  redact: { extra: [] },
  git: { qualifyRepoName: false },
  projects: {},
}

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(false) // not paused
  mockReadConfig.mockReturnValue(BASE_CONFIG)
  mockShouldFilter.mockReturnValue(false)
  mockIsDuplicate.mockReturnValue(false)
  mockGetLastEvent.mockReturnValue(undefined)
  mockGetLastEventForCwd.mockReturnValue(undefined)
  mockRedact.mockImplementation((cmd: string) => cmd)
  mockGetGitContext.mockReturnValue({ repoName: 'myapp', branch: 'main' })
  mockNormalize.mockReturnValue({ category: 'shipping', metadata: {} })
  mockReadLastAiderPrompt.mockReturnValue(null)
})

describe('captureCommand — capture.aiTools kill switch', () => {
  it('inserts the event when capture.aiTools is true and category is ai_session', () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, capture: { ignore: [], aiTools: true } })
    mockNormalize.mockReturnValue({ category: 'ai_session', metadata: { tool: 'claude' } })
    captureCommand({ command: 'claude', cwd: '/repo', exitCode: 0, durationMs: 100 })
    expect(mockInsertEvent).toHaveBeenCalledOnce()
  })

  it('skips ai_session events when capture.aiTools is false', () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, capture: { ignore: [], aiTools: false } })
    mockNormalize.mockReturnValue({ category: 'ai_session', metadata: { tool: 'claude' } })
    captureCommand({ command: 'claude', cwd: '/repo', exitCode: 0, durationMs: 100 })
    expect(mockInsertEvent).not.toHaveBeenCalled()
  })

  it('still captures non-ai_session events when capture.aiTools is false', () => {
    mockReadConfig.mockReturnValue({
      ...BASE_CONFIG,
      capture: { ignore: [], aiTools: false, includeAiderPrompt: true },
    })
    mockNormalize.mockReturnValue({ category: 'shipping', metadata: {} })
    captureCommand({ command: 'git commit', cwd: '/repo', exitCode: 0, durationMs: 50 })
    expect(mockInsertEvent).toHaveBeenCalledOnce()
  })
})

describe('captureCommand — Aider prompt enrichment', () => {
  it('adds prompt to metadata for history-file tools when prompt is found', () => {
    mockNormalize.mockReturnValue({ category: 'ai_session', metadata: { tool: 'aider' } })
    mockReadLastAiderPrompt.mockReturnValue('refactor the payment service')
    captureCommand({ command: 'aider', cwd: '/repo', exitCode: 0, durationMs: 100 })
    const stored = JSON.parse(mockInsertEvent.mock.calls[0][0].metadata)
    expect(stored.prompt).toBe('refactor the payment service')
  })

  it('does not add prompt when readLastAiderPrompt returns null', () => {
    mockNormalize.mockReturnValue({ category: 'ai_session', metadata: { tool: 'aider' } })
    mockReadLastAiderPrompt.mockReturnValue(null)
    captureCommand({ command: 'aider', cwd: '/repo', exitCode: 0, durationMs: 100 })
    const stored = JSON.parse(mockInsertEvent.mock.calls[0][0].metadata)
    expect(stored.prompt).toBeUndefined()
  })

  it('does not call readLastAiderPrompt when includeAiderPrompt is false', () => {
    mockReadConfig.mockReturnValue({
      ...BASE_CONFIG,
      capture: { ignore: [], aiTools: true, includeAiderPrompt: false },
    })
    mockNormalize.mockReturnValue({ category: 'ai_session', metadata: { tool: 'aider' } })
    captureCommand({ command: 'aider', cwd: '/repo', exitCode: 0, durationMs: 100 })
    expect(mockReadLastAiderPrompt).not.toHaveBeenCalled()
  })

  it('does not call readLastAiderPrompt for hook-based tools (e.g. Claude Code)', () => {
    mockNormalize.mockReturnValue({ category: 'ai_session', metadata: { tool: 'claude' } })
    captureCommand({ command: 'claude', cwd: '/repo', exitCode: 0, durationMs: 100 })
    expect(mockReadLastAiderPrompt).not.toHaveBeenCalled()
  })

  it('does not call readLastAiderPrompt for tools with no contextSource', () => {
    mockNormalize.mockReturnValue({ category: 'ai_session', metadata: { tool: 'gemini' } })
    captureCommand({ command: 'gemini', cwd: '/repo', exitCode: 0, durationMs: 100 })
    expect(mockReadLastAiderPrompt).not.toHaveBeenCalled()
  })
})

describe('captureCommand — hint passthrough for other events', () => {
  it('sets metadata.tool to the first token of the command', () => {
    mockNormalize.mockReturnValue({ category: 'other', metadata: {} })
    captureCommand({ command: 'nvm install v22.22.0', cwd: '/repo', exitCode: 0, durationMs: 50 })
    const stored = JSON.parse(mockInsertEvent.mock.calls[0][0].metadata)
    expect(stored.tool).toBe('nvm')
  })

  it('sets metadata.hint to the redacted command string', () => {
    mockNormalize.mockReturnValue({ category: 'other', metadata: {} })
    captureCommand({ command: 'nvm install v22.22.0', cwd: '/repo', exitCode: 0, durationMs: 50 })
    const stored = JSON.parse(mockInsertEvent.mock.calls[0][0].metadata)
    expect(stored.hint).toBe('nvm install v22.22.0')
  })

  it('truncates hint to 120 characters', () => {
    const longCmd = 'x '.repeat(100).trim() // 199 chars
    mockNormalize.mockReturnValue({ category: 'other', metadata: {} })
    captureCommand({ command: longCmd, cwd: '/repo', exitCode: 0, durationMs: 50 })
    const stored = JSON.parse(mockInsertEvent.mock.calls[0][0].metadata)
    expect(stored.hint.length).toBe(120)
  })

  it('does not add hint or tool to non-other events', () => {
    mockNormalize.mockReturnValue({ category: 'shipping', metadata: { message: 'fix: bug' } })
    captureCommand({ command: 'git commit -m "fix: bug"', cwd: '/repo', exitCode: 0, durationMs: 50 })
    const stored = JSON.parse(mockInsertEvent.mock.calls[0][0].metadata)
    expect(stored.hint).toBeUndefined()
    expect(stored.tool).toBeUndefined()
  })
})

describe('captureCommand — task_run cross-source dedup', () => {
  it('skips task_run when a shell-sourced event landed for this cwd moments ago', () => {
    mockGetLastEventForCwd.mockReturnValue({
      cwd: '/repo',
      source: null,
      captured_at: new Date().toISOString(),
    })
    captureCommand({ cwd: '/repo', exitCode: null, durationMs: null, type: 'task_run', source: 'vscode' })
    expect(mockInsertEvent).not.toHaveBeenCalled()
  })

  it('still inserts task_run when the last event for this cwd was IDE-sourced, not shell', () => {
    mockGetLastEventForCwd.mockReturnValue({
      cwd: '/repo',
      source: 'vscode',
      captured_at: new Date().toISOString(),
    })
    captureCommand({ cwd: '/repo', exitCode: null, durationMs: null, type: 'task_run', source: 'vscode' })
    expect(mockInsertEvent).toHaveBeenCalledOnce()
  })

  it('still inserts task_run when the shell-sourced event is outside the dedup window', () => {
    mockGetLastEventForCwd.mockReturnValue({
      cwd: '/repo',
      source: null,
      captured_at: new Date(Date.now() - 60_000).toISOString(),
    })
    captureCommand({ cwd: '/repo', exitCode: null, durationMs: null, type: 'task_run', source: 'vscode' })
    expect(mockInsertEvent).toHaveBeenCalledOnce()
  })

  it('still inserts task_run when there is no prior event for this cwd', () => {
    mockGetLastEventForCwd.mockReturnValue(undefined)
    captureCommand({ cwd: '/repo', exitCode: null, durationMs: null, type: 'task_run', source: 'vscode' })
    expect(mockInsertEvent).toHaveBeenCalledOnce()
  })

  it('does not apply this dedup to other IDE event types', () => {
    mockGetLastEventForCwd.mockReturnValue({
      cwd: '/repo',
      source: null,
      captured_at: new Date().toISOString(),
    })
    captureCommand({ cwd: '/repo', exitCode: null, durationMs: null, type: 'debug_start', source: 'vscode' })
    expect(mockInsertEvent).toHaveBeenCalledOnce()
  })
})
