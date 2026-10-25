import { describe, it, expect, vi } from 'vitest'

vi.mock('child_process', () => ({ execFileSync: vi.fn() }))

import { execFileSync } from 'child_process'
import { getRepoRoot, getUserEmail, getCommitsInWindow, getOthersSubjects } from '../../src/summary/git-commits'

const mockExecFileSync = vi.mocked(execFileSync)

function gitOutput(text: string): void {
  mockExecFileSync.mockReturnValue(Buffer.from(text))
}

function gitFails(): void {
  mockExecFileSync.mockImplementation(() => {
    throw new Error('fatal: not a git repository')
  })
}

const WINDOW = {
  repoRoot: '/Users/dev/api',
  since: '2026-10-25T09:00:00.000Z',
  until: '2026-10-25T10:00:00.000Z',
  author: 'Dev@Example.com',
}

describe('getRepoRoot', () => {
  it('returns the git toplevel for a directory', () => {
    gitOutput('/Users/dev/api\n')

    expect(getRepoRoot('/Users/dev/api/src')).toBe('/Users/dev/api')
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--show-toplevel'],
      expect.objectContaining({ cwd: '/Users/dev/api/src', timeout: 3000 })
    )
  })

  it('is null outside a git repo or without git', () => {
    gitFails()

    expect(getRepoRoot('/tmp')).toBeNull()
  })
})

describe('getUserEmail', () => {
  it('reads user.email for the repo', () => {
    gitOutput('dev@example.com\n')

    expect(getUserEmail('/Users/dev/api')).toBe('dev@example.com')
  })

  it('is null when no email is configured', () => {
    gitFails()

    expect(getUserEmail('/Users/dev/api')).toBeNull()
  })
})

describe('getCommitsInWindow', () => {
  it('widens the session window (2 min before, 1 min after) and asks for oldest first', () => {
    gitOutput('')

    getCommitsInWindow(WINDOW)

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      [
        'log',
        '--since=2026-10-25T08:58:00.000Z',
        '--until=2026-10-25T10:01:00.000Z',
        '--format=%h%x09%ce%x09%s',
        '--reverse',
      ],
      expect.objectContaining({ cwd: '/Users/dev/api' })
    )
  })

  it('keeps only commits by the author, matching email case-insensitively', () => {
    gitOutput(
      'a1b2c3d\tdev@example.com\tfix: token validation\n' +
        'e4f5a6b\tteammate@example.com\tunrelated change\n' +
        '\n' +
        'c7d8e9f\tDEV@example.com\tadd refresh endpoint\n'
    )

    expect(getCommitsInWindow(WINDOW)).toEqual([
      { hash: 'a1b2c3d', subject: 'fix: token validation' },
      { hash: 'c7d8e9f', subject: 'add refresh endpoint' },
    ])
  })

  it('keeps every commit when there is no author to filter by', () => {
    gitOutput('a1b2c3d\tdev@example.com\tone\ne4f5a6b\tteammate@example.com\ttwo\n')

    expect(getCommitsInWindow({ ...WINDOW, author: null })).toHaveLength(2)
  })

  it('keeps tabs inside a subject', () => {
    gitOutput('a1b2c3d\tdev@example.com\tsubject\twith tab\n')

    expect(getCommitsInWindow(WINDOW)).toEqual([{ hash: 'a1b2c3d', subject: 'subject\twith tab' }])
  })

  it('returns nothing when git fails', () => {
    gitFails()

    expect(getCommitsInWindow(WINDOW)).toEqual([])
  })
})

describe('getOthersSubjects', () => {
  it('returns subjects in recent history committed only by other people', () => {
    gitOutput(
      'teammate@example.com\tteammate feature\n' +
        'dev@example.com\tmy fix\n' +
        'teammate@example.com\twip\n' +
        'DEV@example.com\twip\n'
    )

    expect(getOthersSubjects('/Users/dev/api', 'dev@example.com')).toEqual(['teammate feature'])
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['log', '-n500', '--format=%ce%x09%s'],
      expect.objectContaining({ cwd: '/Users/dev/api' })
    )
  })

  it('returns nothing without an author to compare against', () => {
    expect(getOthersSubjects('/Users/dev/api', null)).toEqual([])
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })

  it('returns nothing when git fails', () => {
    gitFails()

    expect(getOthersSubjects('/Users/dev/api', 'dev@example.com')).toEqual([])
  })
})
