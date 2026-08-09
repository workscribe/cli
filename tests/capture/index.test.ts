import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({ default: { existsSync: vi.fn() } }))

vi.mock('../../src/db', () => ({
  insertEvent: vi.fn(),
  getLastEvent: vi.fn(),
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

vi.mock('../../src/utils/paths', () => ({ PAUSE_FLAG_PATH: '/home/user/.workscribe/paused' }))

import fs from 'fs'
import { insertEvent, getLastEvent } from '../../src/db'
import { readConfig } from '../../src/config'
import { normalizeCommand } from '../../src/normalize/patterns'
import { shouldFilter, isDuplicate } from '../../src/capture/filter'
import { redact } from '../../src/capture/redact'
import { getGitContext } from '../../src/capture/git'
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

const BASE_CONFIG = {
  capture: { ignore: [], aiTools: true },
  redact: { extra: [] },
  projects: {},
}

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(false) // not paused
  mockReadConfig.mockReturnValue(BASE_CONFIG)
  mockShouldFilter.mockReturnValue(false)
  mockIsDuplicate.mockReturnValue(false)
  mockGetLastEvent.mockReturnValue(undefined)
  mockRedact.mockImplementation((cmd: string) => cmd)
  mockGetGitContext.mockReturnValue({ repoName: 'myapp', branch: 'main' })
  mockNormalize.mockReturnValue({ category: 'code_commit', metadata: {} })
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
    mockReadConfig.mockReturnValue({ ...BASE_CONFIG, capture: { ignore: [], aiTools: false } })
    mockNormalize.mockReturnValue({ category: 'code_commit', metadata: {} })
    captureCommand({ command: 'git commit', cwd: '/repo', exitCode: 0, durationMs: 50 })
    expect(mockInsertEvent).toHaveBeenCalledOnce()
  })
})
