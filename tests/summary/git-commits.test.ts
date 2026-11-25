import { describe, it, expect, vi } from 'vitest'

vi.mock('child_process', () => ({ execFileSync: vi.fn() }))

import { execFileSync } from 'child_process'
import {
  getRepoRoot,
  getRepoRootOf,
  getIgnoredPaths,
  getUserEmail,
  getCommitsInWindow,
  findCommitsInWindow,
  getOthersSubjects,
  getFileCommits,
} from '../../src/summary/git-commits'

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
        '--format=%h%x09%ce%x09%cI%x09%s',
        '--reverse',
      ],
      expect.objectContaining({ cwd: '/Users/dev/api' })
    )
  })

  it('keeps only commits by the author, matching email case-insensitively', () => {
    gitOutput(
      'a1b2c3d\tdev@example.com\t2026-10-25T09:15:00+01:00\tfix: token validation\n' +
        'e4f5a6b\tteammate@example.com\t2026-10-25T09:15:00+01:00\tunrelated change\n' +
        '\n' +
        'c7d8e9f\tDEV@example.com\t2026-10-25T09:40:00+01:00\tadd refresh endpoint\n'
    )

    expect(getCommitsInWindow(WINDOW)).toEqual([
      { hash: 'a1b2c3d', subject: 'fix: token validation', committedAt: '2026-10-25T09:15:00+01:00' },
      { hash: 'c7d8e9f', subject: 'add refresh endpoint', committedAt: '2026-10-25T09:40:00+01:00' },
    ])
  })

  it('keeps every commit when there is no author to filter by', () => {
    gitOutput(
      'a1b2c3d\tdev@example.com\t2026-10-25T09:15:00+01:00\tone\ne4f5a6b\tteammate@example.com\t2026-10-25T09:15:00+01:00\ttwo\n'
    )

    expect(getCommitsInWindow({ ...WINDOW, author: null })).toHaveLength(2)
  })

  it('keeps tabs inside a subject', () => {
    gitOutput('a1b2c3d\tdev@example.com\t2026-10-25T09:15:00+01:00\tsubject\twith tab\n')

    expect(getCommitsInWindow(WINDOW)).toEqual([
      { hash: 'a1b2c3d', subject: 'subject\twith tab', committedAt: '2026-10-25T09:15:00+01:00' },
    ])
  })

  it('skips a line with no commit time, rather than reading the subject as one', () => {
    gitOutput('a1b2c3d\tdev@example.com\t\tno date\nc7d8e9f\tdev@example.com\t2026-10-25T09:40:00+01:00\tdated\n')

    expect(getCommitsInWindow(WINDOW)).toEqual([
      { hash: 'c7d8e9f', subject: 'dated', committedAt: '2026-10-25T09:40:00+01:00' },
    ])
  })

  it('returns nothing when git fails', () => {
    gitFails()

    expect(getCommitsInWindow(WINDOW)).toEqual([])
  })

  it('looks on every local branch when asked, not just HEAD', () => {
    gitOutput('')

    findCommitsInWindow({ ...WINDOW, allBranches: true })

    expect(mockExecFileSync).toHaveBeenCalledWith('git', expect.arrayContaining(['--branches']), expect.any(Object))
  })

  it('tells "git could not answer" (null) apart from "no commits" ([])', () => {
    gitFails()
    expect(findCommitsInWindow(WINDOW)).toBeNull()

    gitOutput('')
    expect(findCommitsInWindow(WINDOW)).toEqual([])
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

describe('getFileCommits — timeouts handed to git', () => {
  it('passes each call exactly the time it checked, never 0 (Node reads a timeout of 0 as no timeout)', () => {
    mockExecFileSync.mockImplementation(((_file: string, args: string[]) =>
      Buffer.from(args[0] === 'rev-parse' ? '/Users/dev/api\n' : '')) as typeof execFileSync)
    // Deadline at 2000; each git call costs the clock ticks below, ending 1 ms short of it
    const clock = [0, 0, 1000, 1999]
    const now = () => clock.shift() ?? 5000

    getFileCommits({
      filePath: '/Users/dev/api/README.md',
      since: WINDOW.since,
      until: WINDOW.until,
      budgetMs: 2000,
      now,
    })

    const timeouts = mockExecFileSync.mock.calls.map(([, , options]) => (options as { timeout: number }).timeout)
    expect(timeouts).toEqual([2000, 1000, 1])
  })

  it('stops calling git once the budget is spent, rather than passing a timeout of 0', () => {
    gitOutput('/Users/dev/api\n')
    const clock = [0, 0, 2000]
    const now = () => clock.shift() ?? 5000

    const result = getFileCommits({
      filePath: '/Users/dev/api/README.md',
      since: WINDOW.since,
      until: WINDOW.until,
      budgetMs: 2000,
      now,
    })

    expect(result).toEqual({ repoRoot: '/Users/dev/api', commits: [] })
    expect(mockExecFileSync).toHaveBeenCalledTimes(1)
  })
})

describe('getRepoRootOf', () => {
  it('walks up from the folder as it was given, not to the symlink-resolved toplevel', () => {
    gitOutput('../../\n')

    expect(getRepoRootOf('/tmp/app/src/db')).toBe('/tmp/app')
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--show-cdup'],
      expect.objectContaining({ cwd: '/tmp/app/src/db' })
    )
  })

  it('is the folder itself at the top of the repository', () => {
    gitOutput('\n')

    expect(getRepoRootOf('/tmp/app')).toBe('/tmp/app')
  })

  it('is null outside a repository, for a folder that is gone, or without git', () => {
    gitFails()

    expect(getRepoRootOf('/tmp/gone')).toBeNull()
  })
})

describe('getIgnoredPaths', () => {
  it('sends the paths on stdin, NUL-separated, and never in the arguments', () => {
    gitOutput('a.log\0dir\0')

    expect(getIgnoredPaths('/repo', ['a.log', '-rf', 'dir'], 500)).toEqual(new Set(['a.log', 'dir']))
    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['check-ignore', '-z', '--stdin'],
      expect.objectContaining({ cwd: '/repo', timeout: 500, input: 'a.log\0-rf\0dir' })
    )
  })

  it('asks git nothing when there are no paths', () => {
    expect(getIgnoredPaths('/repo', [])).toEqual(new Set())
    expect(mockExecFileSync).not.toHaveBeenCalled()
  })

  it('says none is ignored when git exits with status 1', () => {
    mockExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error('exit 1'), { status: 1 })
    })

    expect(getIgnoredPaths('/repo', ['a.ts'])).toEqual(new Set())
  })

  it('says it cannot tell when git fails any other way', () => {
    mockExecFileSync.mockImplementation(() => {
      throw Object.assign(new Error('fatal'), { status: 128 })
    })

    expect(getIgnoredPaths('/repo', ['a.ts'])).toBeNull()
  })
})
