import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => ({ execSync: vi.fn() }))

import { execSync } from 'child_process'
import { getCommitsSince } from '../../src/capture/git-snapshot'

const mockExecSync = execSync as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('getCommitsSince', () => {
  it('returns empty array when sha is empty', () => {
    expect(getCommitsSince('', '/some/path')).toEqual([])
    expect(mockExecSync).not.toHaveBeenCalled()
  })

  it('returns empty array when no commits have been made since sha', () => {
    mockExecSync.mockReturnValue(Buffer.from(''))
    expect(getCommitsSince('abc123', '/some/path')).toEqual([])
  })

  it('returns commit subject lines since the given sha', () => {
    mockExecSync.mockReturnValue(Buffer.from('feat: add OAuth2\nfix: token expiry\n'))
    expect(getCommitsSince('abc123', '/some/path')).toEqual(['feat: add OAuth2', 'fix: token expiry'])
  })

  it('returns a single commit correctly', () => {
    mockExecSync.mockReturnValue(Buffer.from('chore: update deps\n'))
    expect(getCommitsSince('abc123', '/some/path')).toEqual(['chore: update deps'])
  })

  it('filters out blank lines from git output', () => {
    mockExecSync.mockReturnValue(Buffer.from('feat: add login\n\nfix: edge case\n'))
    const result = getCommitsSince('abc123', '/some/path')
    expect(result).toEqual(['feat: add login', 'fix: edge case'])
  })

  it('returns empty array when git command fails', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repo')
    })
    expect(getCommitsSince('abc123', '/some/path')).toEqual([])
  })

  it('passes cwd to execSync', () => {
    mockExecSync.mockReturnValue(Buffer.from(''))
    getCommitsSince('abc123', '/my/project')
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('git log abc123..HEAD'),
      expect.objectContaining({ cwd: '/my/project' })
    )
  })

  it('uses a timeout to prevent hanging', () => {
    mockExecSync.mockReturnValue(Buffer.from(''))
    getCommitsSince('abc123', '/my/project')
    expect(mockExecSync).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 3000 }))
  })
})
