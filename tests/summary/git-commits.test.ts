import { describe, it, expect, vi } from 'vitest'

vi.mock('child_process', () => ({ execFileSync: vi.fn() }))

import { execFileSync } from 'child_process'
import {
  getRepoRoot,
  getRepoRootOf,
  getIgnoredPaths,
  getCommitSizes,
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

describe('getCommitSizes', () => {
  const MARKER = '\u0001'
  const shown = (hash: string, parents: string, numstat: string) => `${MARKER}${hash}\t${parents}\n\n${numstat}\n`
  const hashes = (count: number) =>
    Array.from({ length: count }, (_unused, index) => `abc${index.toString(16).padStart(4, '0')}`)

  it('passes only hashes to git, as arguments ending with --, with room for a large answer', () => {
    gitOutput(shown('a1b2c3d', 'p1', '1\t0\ta.ts'))

    getCommitSizes('/repo', ['a1b2c3d', '--output=x', 'HEAD', 'e4f5a6b'], 500)

    expect(mockExecFileSync).toHaveBeenCalledWith(
      'git',
      ['show', '--numstat', `--format=${MARKER}%h%x09%P`, 'a1b2c3d', 'e4f5a6b', '--'],
      expect.objectContaining({ cwd: '/repo', timeout: 500, maxBuffer: 16 * 1024 * 1024 })
    )
  })

  it('counts a commit by its numstat lines, and leaves out a merge and a commit with no changed file', () => {
    gitOutput(
      [
        shown('a1b2c3d', 'p1', '2\t1\ta.ts\n-\t-\tbin.dat'),
        shown('e4f5a6b', 'p1 p2', '9\t9\tmerged.ts'),
        `${MARKER}0a0a0a0\tp1\n`,
      ].join('')
    )

    const sizes = getCommitSizes('/repo', ['a1b2c3d', 'e4f5a6b', '0a0a0a0'])

    expect(sizes).toEqual(new Map([['a1b2c3d', { files: 2, added: 2, removed: 1 }]]))
  })

  it('asks in batches of 100 and puts the answers together', () => {
    mockExecFileSync.mockReturnValueOnce(Buffer.from(shown('abc0000', 'p', '1\t0\ta.ts')))
    mockExecFileSync.mockReturnValueOnce(Buffer.from(shown('abc0064', 'p', '3\t2\tb.ts')))
    mockExecFileSync.mockReturnValueOnce(Buffer.from(''))

    const sizes = getCommitSizes('/repo', hashes(250))

    expect(mockExecFileSync).toHaveBeenCalledTimes(3)
    expect([...(sizes?.keys() ?? [])]).toEqual(['abc0000', 'abc0064'])
  })

  it('keeps what the earlier batches answered when a later one fails, and is null when the first fails', () => {
    mockExecFileSync.mockReturnValueOnce(Buffer.from(shown('abc0000', 'p', '1\t0\ta.ts')))
    mockExecFileSync.mockImplementationOnce(() => {
      throw new Error('timed out')
    })
    expect([...(getCommitSizes('/repo', hashes(150))?.keys() ?? [])]).toEqual(['abc0000'])

    gitFails()
    expect(getCommitSizes('/repo', hashes(150))).toBeNull()
  })

  it('leaves the commits of a batch the budget does not reach unsized, and asks git nothing more', () => {
    mockExecFileSync.mockReturnValueOnce(Buffer.from(shown('abc0000', 'p', '1\t0\ta.ts')))
    // The deadline is set at 0 + 100; the first batch starts at 0, the second at 200
    const clock = [0, 0, 200]
    const now = vi.spyOn(Date, 'now').mockImplementation(() => clock.shift() ?? 9000)

    const sizes = getCommitSizes('/repo', hashes(150), 100)
    now.mockRestore()

    expect(mockExecFileSync).toHaveBeenCalledTimes(1)
    expect([...(sizes?.keys() ?? [])]).toEqual(['abc0000'])
  })
})
