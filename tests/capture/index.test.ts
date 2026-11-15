import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({ default: { existsSync: vi.fn() } }))

vi.mock('../../src/db', () => ({
  insertEvent: vi.fn(),
  getLastEvent: vi.fn(),
  mergeRecentEdit: vi.fn(),
  getLastEventForCwd: vi.fn(),
}))

vi.mock('../../src/config', () => ({ readConfig: vi.fn() }))

vi.mock('../../src/normalize/patterns', () => ({ normalizeCommand: vi.fn() }))

vi.mock('../../src/capture/filter', () => ({
  shouldFilter: vi.fn(),
  isDuplicate: vi.fn(),
}))

vi.mock('../../src/capture/redact', () => ({ redact: vi.fn() }))

vi.mock('../../src/capture/git', () => ({ getRepoContext: vi.fn() }))

vi.mock('../../src/capture/git-snapshot', () => ({ getCommitsSince: vi.fn(), latestCommitSubject: vi.fn() }))

vi.mock('../../src/capture/aider', () => ({ readLastAiderPrompt: vi.fn() }))

vi.mock('../../src/capture/commit-message-file', () => ({ readCommitMessageFile: vi.fn() }))

vi.mock('../../src/config/registry', () => ({
  loadAIToolRegistry: vi.fn().mockReturnValue([
    { tool: 'claude', pattern: '^claude\\b', hook: 'claude-code', contextSource: 'hook' },
    { tool: 'aider', pattern: '^aider\\b', hook: null, contextSource: 'history-file' },
    { tool: 'gemini', pattern: '^gemini\\b', hook: null, contextSource: null },
  ]),
}))

vi.mock('../../src/utils/paths', () => ({ PAUSE_FLAG_PATH: '/home/user/.workscribe/paused' }))

import fs from 'fs'
import { insertEvent, getLastEvent, getLastEventForCwd, mergeRecentEdit } from '../../src/db'
import { readConfig } from '../../src/config'
import { normalizeCommand } from '../../src/normalize/patterns'
import { shouldFilter, isDuplicate } from '../../src/capture/filter'
import { redact } from '../../src/capture/redact'
import { getRepoContext } from '../../src/capture/git'
import { readCommitMessageFile } from '../../src/capture/commit-message-file'
import { getCommitsSince, latestCommitSubject } from '../../src/capture/git-snapshot'
import { readLastAiderPrompt } from '../../src/capture/aider'
import { captureCommand } from '../../src/capture'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockInsertEvent = insertEvent as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockNormalize = normalizeCommand as ReturnType<typeof vi.fn>
const mockShouldFilter = shouldFilter as ReturnType<typeof vi.fn>
const mockIsDuplicate = isDuplicate as ReturnType<typeof vi.fn>
const mockRedact = redact as ReturnType<typeof vi.fn>
const mockGetRepoContext = getRepoContext as ReturnType<typeof vi.fn>
const mockGetLastEvent = getLastEvent as ReturnType<typeof vi.fn>
const mockGetLastEventForCwd = getLastEventForCwd as ReturnType<typeof vi.fn>
const mockMergeRecentEdit = mergeRecentEdit as ReturnType<typeof vi.fn>
const mockReadLastAiderPrompt = readLastAiderPrompt as ReturnType<typeof vi.fn>

const BASE_CONFIG = {
  capture: { ignore: [], aiTools: true, includeAiderPrompt: true },
  redact: { extra: [] },
  git: { qualifyRepoName: false },
  projects: {},
  tickets: { pattern: '[A-Z][A-Z0-9]+-\\d+' },
}

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(false) // not paused
  mockReadConfig.mockReturnValue(BASE_CONFIG)
  mockShouldFilter.mockReturnValue(false)
  mockIsDuplicate.mockReturnValue(false)
  mockGetLastEvent.mockReturnValue(undefined)
  mockGetLastEventForCwd.mockReturnValue(undefined)
  mockRedact.mockImplementation((cmd: string) => cmd)
  mockGetRepoContext.mockReturnValue({ repoName: 'myapp', branch: 'main', root: '/repo', remote: null })
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

// WOR-118: the shell path once skipped git.qualifyRepoName, so shell and IDE events for one repo got different names
describe('captureCommand — repo naming', () => {
  const QUALIFIED_CONFIG = { ...BASE_CONFIG, git: { qualifyRepoName: true }, projects: { '/repo': 'my-name' } }

  beforeEach(() => {
    mockReadConfig.mockReturnValue(QUALIFIED_CONFIG)
    mockGetRepoContext.mockReturnValue({ repoName: 'acme/api', branch: 'main', root: '/repo', remote: null })
  })

  it('names shell (and AI-tool hook) events from the full config', () => {
    captureCommand({ command: 'npm test', cwd: '/repo', exitCode: 0, durationMs: 10 })

    expect(mockGetRepoContext).toHaveBeenCalledWith('/repo', QUALIFIED_CONFIG)
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ repo_name: 'acme/api' }))
  })

  it('names IDE events from the same config, so both paths agree', () => {
    captureCommand({ cwd: '/repo', exitCode: null, durationMs: null, type: 'task_run', source: 'vscode' })

    expect(mockGetRepoContext).toHaveBeenCalledWith('/repo', QUALIFIED_CONFIG)
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ repo_name: 'acme/api' }))
  })
})

describe('captureCommand — project links', () => {
  const API_PROJECT = { identity: 'remote:github.com/acme/api', kind: 'remote' }

  beforeEach(() => {
    mockGetRepoContext.mockReturnValue({
      repoName: 'api',
      branch: 'main',
      root: '/repo',
      remote: null,
      project: API_PROJECT,
    })
  })

  it("links a shell event to the work directory's project and branch", () => {
    captureCommand({ command: 'npm test', cwd: '/repo', exitCode: 0, durationMs: 10 })

    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        repo_name: 'api',
        dimensions: { project: { ...API_PROJECT, name: 'api', root: '/repo' }, branch: 'main', file: null },
      })
    )
  })

  it('redacts a command from an IDE, even when it also names a file', () => {
    mockRedact.mockReturnValue('run --password=[REDACTED]')

    captureCommand({
      command: 'run --password=FAKEVALUE',
      cwd: '/repo',
      exitCode: null,
      durationMs: null,
      type: 'task_run',
      file: '/repo/src/a.ts',
    })

    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'run --password=[REDACTED]', file_path: '/repo/src/a.ts' })
    )
  })

  it("stores an edit's line counts", () => {
    captureCommand({
      cwd: '/repo',
      exitCode: null,
      durationMs: null,
      type: 'code_edit',
      file: '/repo/src/a.ts',
      source: 'vscode',
      linesAdded: 3,
      linesRemoved: 1,
    })

    expect(mockMergeRecentEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/repo/src/a.ts',
        cwd: '/repo',
        source: 'vscode',
        counts: { linesAdded: 3, linesRemoved: 1 },
        windowMs: 30_000,
      })
    )
    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: '{"linesAdded":3,"linesRemoved":1}' })
    )
  })

  it('stores unknown counts as null when the sender gave none', () => {
    captureCommand({ cwd: '/repo', exitCode: null, durationMs: null, type: 'code_edit', file: '/repo/src/a.ts' })

    expect(mockMergeRecentEdit).toHaveBeenCalledWith(expect.objectContaining({ source: null }))
    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: '{"linesAdded":null,"linesRemoved":null}' })
    )
  })

  it('stores nothing new when the edit merged into a recent one', () => {
    mockMergeRecentEdit.mockReturnValueOnce(true)

    captureCommand({ cwd: '/repo', exitCode: null, durationMs: null, type: 'code_edit', file: '/repo/src/a.ts' })

    expect(mockInsertEvent).not.toHaveBeenCalled()
  })

  it('keeps other editor events without metadata, and never merges them', () => {
    captureCommand({ cwd: '/repo', exitCode: null, durationMs: null, type: 'debug_start', file: '/repo/src/a.ts' })

    expect(mockMergeRecentEdit).not.toHaveBeenCalled()
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ metadata: null }))
  })

  it('stores a save with no command under its path, without redacting it', () => {
    captureCommand({ cwd: '/repo', exitCode: null, durationMs: null, type: 'code_edit', file: '/repo/src/a.ts' })

    expect(mockRedact).not.toHaveBeenCalled()
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ command: '/repo/src/a.ts' }))
  })

  it('links an editor save to its file, keeping the text columns as before', () => {
    captureCommand({ cwd: '/repo', exitCode: null, durationMs: null, type: 'code_edit', file: '/repo/src/a.ts' })

    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        repo_name: 'api',
        file_path: '/repo/src/a.ts',
        dimensions: expect.objectContaining({ file: { relativePath: 'src/a.ts', action: 'save' } }),
      })
    )
  })
})

// WOR-144: the tickets an event names go with it to the writer, which links them with its project
describe('captureCommand — tickets', () => {
  const CLI_PROJECT = { identity: 'remote:github.com/workscribe/cli', kind: 'remote' }

  beforeEach(() => {
    mockGetRepoContext.mockReturnValue({
      repoName: 'cli',
      branch: 'feat/WOR-123-context-file-details',
      root: '/repo',
      remote: null,
      project: CLI_PROJECT,
    })
  })

  it("passes a shell commit's tickets from its branch and its message", () => {
    mockNormalize.mockReturnValue({ category: 'shipping', metadata: { message: 'WOR-7 fix the redirect' } })

    captureCommand({ command: 'git commit -m "WOR-7 fix the redirect"', cwd: '/repo', exitCode: 0, durationMs: 10 })

    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tickets: { branch: ['WOR-123'], commits: ['WOR-7'] } })
    )
  })

  it("passes an editor save's branch ticket, and none for a save in another repo", () => {
    captureCommand({ cwd: '/repo', exitCode: null, durationMs: null, type: 'code_edit', file: '/repo/src/a.ts' })
    expect(mockInsertEvent).toHaveBeenLastCalledWith(
      expect.objectContaining({ tickets: { branch: ['WOR-123'], commits: [] } })
    )

    // A file outside the open folder's repo: its branch isn't linked, so it names no ticket
    mockGetRepoContext.mockReturnValue({ repoName: null, branch: 'feat/WOR-123-x', root: null, remote: null })
    captureCommand({ cwd: '/elsewhere', exitCode: null, durationMs: null, type: 'code_edit', file: '/other/b.ts' })
    expect(mockInsertEvent).toHaveBeenLastCalledWith(expect.objectContaining({ tickets: { branch: [], commits: [] } }))
  })

  it('uses the default pattern when config.json has no tickets section', () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, tickets: undefined })

    captureCommand({ command: 'npm test', cwd: '/repo', exitCode: 0, durationMs: 10 })

    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tickets: { branch: ['WOR-123'], commits: [] } })
    )
  })
})

// WOR-143: a hook command records the agent conversation it came from
describe('captureCommand — agent sessions', () => {
  const CONVERSATION = { source: 'claude-code', sessionId: 'conversation-1' }

  it('passes the agent session on with a shell command', () => {
    captureCommand({ command: 'npm test', cwd: '/repo', exitCode: 0, durationMs: 10, agentSession: CONVERSATION })

    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ agentSession: CONVERSATION }))
  })

  it('passes none with a shell command that came without one', () => {
    captureCommand({ command: 'npm test', cwd: '/repo', exitCode: 0, durationMs: 10 })

    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ agentSession: undefined }))
  })

  it("links an agent's edit to its session, and passes it to the merge", () => {
    captureCommand({
      cwd: '/repo',
      exitCode: null,
      durationMs: null,
      type: 'code_edit',
      file: '/repo/src/a.ts',
      source: 'claude-code',
      agentSession: CONVERSATION,
    })

    expect(mockMergeRecentEdit).toHaveBeenCalledWith(expect.objectContaining({ agentSession: CONVERSATION }))
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ agentSession: CONVERSATION }))
  })

  it('links an editor save to no session', () => {
    captureCommand({ cwd: '/repo', exitCode: null, durationMs: null, type: 'code_edit', file: '/repo/src/a.ts' })

    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ agentSession: undefined }))
  })
})

// WOR-127: a commit belongs to the repo it was made in, which isn't always where the command was typed
describe('captureCommand — where the work happened', () => {
  function capturedWith(command: string, matchedStep: string, source?: string) {
    mockNormalize.mockReturnValue({ category: 'shipping', metadata: { message: 'x' }, matchedStep })
    captureCommand({ command, cwd: '/r/api', exitCode: 0, durationMs: 10, source })
    return vi.mocked(getRepoContext).mock.calls.at(-1)?.[0]
  }

  it('credits a `git -C` commit to that directory, and keeps the cwd the command ran in', () => {
    expect(capturedWith('git -C ../web commit -m x', 'git -C ../web commit -m x')).toBe('/r/web')
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/r/api' }))
  })

  it("doesn't follow a leading `cd` for any source — cwd is already where the shell ended up", () => {
    expect(capturedWith('cd /r/web && git commit -m x', 'git commit -m x', 'claude-code')).toBe('/r/api')
    expect(capturedWith('cd /r/web && git commit -m x', 'git commit -m x')).toBe('/r/api')
  })

  it('reads a `-F <file>` message from the work directory, redacted, and never stores the path', () => {
    mockNormalize.mockReturnValue({
      category: 'shipping',
      metadata: { message: null, messageFile: 'msg.txt' },
      matchedStep: 'git -C ../web commit -F msg.txt',
    })
    vi.mocked(readCommitMessageFile).mockReturnValue('feat: from a file')

    captureCommand({ command: 'git -C ../web commit -F msg.txt', cwd: '/r/api', exitCode: 0, durationMs: 10 })

    expect(readCommitMessageFile).toHaveBeenCalledWith('msg.txt', '/r/web')
    const stored = JSON.parse(vi.mocked(mockInsertEvent).mock.calls[0][0].metadata as string)
    expect(stored).toEqual({ message: 'feat: from a file' })
  })

  it("redacts an AI session's commit subjects, with the configured patterns", () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, redact: { extra: ['INTERNAL'] } })
    mockNormalize.mockReturnValue({ category: 'ai_session', metadata: { tool: 'claude' }, matchedStep: 'claude' })
    vi.mocked(getCommitsSince).mockReturnValue(['set --password=FAKEVALUE'])
    mockRedact.mockImplementation((text: string, extra: string[]) =>
      extra.includes('INTERNAL') ? text.replace('FAKEVALUE', '[REDACTED]') : text
    )

    captureCommand({ command: 'claude', cwd: '/r/api', exitCode: 0, durationMs: 10, gitBefore: 'abc123' })

    const stored = JSON.parse(mockInsertEvent.mock.calls[0][0].metadata as string) as { commits: string[] }
    expect(stored.commits).toEqual(['set --password=[REDACTED]'])
  })

  it('passes the configured patterns to an Aider prompt', () => {
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, redact: { extra: ['INTERNAL'] } })
    mockNormalize.mockReturnValue({ category: 'ai_session', metadata: { tool: 'aider' } })

    captureCommand({ command: 'aider', cwd: '/repo', exitCode: 0, durationMs: 10 })

    expect(mockReadLastAiderPrompt).toHaveBeenCalledWith('/repo', ['INTERNAL'])
  })

  it("looks for an AI session's commits in the work directory", () => {
    mockNormalize.mockReturnValue({ category: 'ai_session', metadata: { tool: 'claude' }, matchedStep: 'claude' })
    vi.mocked(getCommitsSince).mockReturnValue([])

    captureCommand({ command: 'claude', cwd: '/r/api', exitCode: 0, durationMs: 10, gitBefore: 'abc123' })

    expect(getCommitsSince).toHaveBeenCalledWith('abc123', '/r/api')
  })
})

describe('captureCommand — the commit check, for a source that reports no failure', () => {
  const commit = { command: 'git commit -m "fix: bug"', cwd: '/repo', exitCode: null, durationMs: null }

  beforeEach(() => {
    mockNormalize.mockReturnValue({ category: 'shipping', metadata: { message: 'fix: bug' } })
  })

  it('stores -1 for a commit HEAD does not show, so it never reads as committed', () => {
    vi.mocked(latestCommitSubject).mockReturnValue('an earlier commit')

    captureCommand({ ...commit, verifyCommit: true })

    expect(mockInsertEvent.mock.calls[0][0].exit_code).toBe(-1)
  })

  it('leaves a commit that landed unknown', () => {
    vi.mocked(latestCommitSubject).mockReturnValue('fix: bug')

    captureCommand({ ...commit, verifyCommit: true })

    expect(mockInsertEvent.mock.calls[0][0].exit_code).toBeNull()
  })

  it('never asks git for a source that did not turn it on', () => {
    captureCommand(commit)

    expect(latestCommitSubject).not.toHaveBeenCalled()
    expect(mockInsertEvent.mock.calls[0][0].exit_code).toBeNull()
  })

  it('never asks git about a command that is not a commit', () => {
    mockNormalize.mockReturnValue({ category: 'testing', metadata: {} })

    captureCommand({ ...commit, command: 'npm test', verifyCommit: true })

    expect(latestCommitSubject).not.toHaveBeenCalled()
  })
})
