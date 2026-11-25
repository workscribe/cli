import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/summary/git-commits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/summary/git-commits')>()),
  getRepoRoot: vi.fn(),
  getUserEmail: vi.fn(),
  findCommitsInWindow: vi.fn(),
  getCommitSizes: vi.fn(() => null),
}))

import { findCommitsInWindow, getCommitSizes, getRepoRoot, getUserEmail } from '../../src/summary/git-commits'
import { lookupDayCommits } from '../../src/summary/day-commits'

const mockGetRepoRoot = vi.mocked(getRepoRoot)
const mockGetUserEmail = vi.mocked(getUserEmail)
const mockFindCommitsInWindow = vi.mocked(findCommitsInWindow)
const mockGetCommitSizes = vi.mocked(getCommitSizes)

function windowIn(repo: string, startedAt: string, endedAt: string) {
  return { cwd: `/Users/dev/${repo}`, startedAt, endedAt }
}

const MORNING = windowIn('api', '2026-10-25T09:00:00.000Z', '2026-10-25T10:00:00.000Z')
const AFTERNOON = windowIn('api', '2026-10-25T14:00:00.000Z', '2026-10-25T15:00:00.000Z')
const WEB = windowIn('web', '2026-10-25T11:00:00.000Z', '2026-10-25T12:00:00.000Z')

function gitRepos(): void {
  mockGetRepoRoot.mockImplementation((cwd) => cwd)
  mockGetUserEmail.mockReturnValue('dev@example.com')
}

describe('lookupDayCommits', () => {
  it("makes one git log per repo, from its windows' earliest start to their latest end", () => {
    gitRepos()
    mockFindCommitsInWindow.mockReturnValue([])

    lookupDayCommits([MORNING, WEB, AFTERNOON], { budgetMs: 3000 })

    expect(mockFindCommitsInWindow).toHaveBeenCalledTimes(2)
    expect(mockFindCommitsInWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        repoRoot: '/Users/dev/api',
        since: '2026-10-25T09:00:00.000Z',
        until: '2026-10-25T15:00:00.000Z',
        author: 'dev@example.com',
        // A commit made on feat/x still counts after you're back on main
        allBranches: true,
      })
    )
  })

  it('gives each window the commits made during it', () => {
    gitRepos()
    mockFindCommitsInWindow.mockReturnValue([
      { hash: 'a1b2c3d', subject: 'morning fix', committedAt: '2026-10-25T09:30:00.000Z' },
      { hash: 'e4f5a6b', subject: 'afternoon feature', committedAt: '2026-10-25T14:30:00.000Z' },
    ])

    const [morning, afternoon] = lookupDayCommits([MORNING, AFTERNOON], { budgetMs: 3000 })

    expect(morning.map((commit) => commit.subject)).toEqual(['morning fix'])
    expect(afternoon.map((commit) => commit.subject)).toEqual(['afternoon feature'])
  })

  it('gives git the time left, never 0 (Node reads a timeout of 0 as no timeout)', () => {
    gitRepos()
    mockFindCommitsInWindow.mockReturnValue([])
    // Deadline at 3000; the clock ticks past each call, ending 1 ms short of it
    const clock = [0, 0, 1000, 2000, 2999]
    const now = () => clock.shift() ?? 9000

    lookupDayCommits([MORNING], { budgetMs: 3000, now })

    expect(mockGetRepoRoot).toHaveBeenCalledWith('/Users/dev/api', 3000)
    expect(mockGetUserEmail).toHaveBeenCalledWith('/Users/dev/api', 2000)
    expect(mockFindCommitsInWindow).toHaveBeenCalledWith(expect.objectContaining({ timeoutMs: 1000 }))
  })

  it('shares one budget across repos, and asks git nothing more once it is spent', () => {
    gitRepos()
    mockFindCommitsInWindow.mockReturnValue([])
    // The first repo's calls use up the budget; the second repo is never asked
    const clock = [0, 0, 500, 1000, 1500, 3000]
    const now = () => clock.shift() ?? 9000

    const result = lookupDayCommits([MORNING, WEB], { budgetMs: 3000, now })

    expect(mockGetRepoRoot).toHaveBeenCalledTimes(2)
    expect(mockFindCommitsInWindow).toHaveBeenCalledTimes(1)
    // The second repo wasn't asked, which isn't the same as git finding nothing
    expect(result).toEqual([[], null])
  })

  it("doesn't ask for commits without your committer email, so teammates' commits aren't told as yours", () => {
    mockGetRepoRoot.mockImplementation((cwd) => cwd)
    mockGetUserEmail.mockReturnValue(null)

    expect(lookupDayCommits([MORNING], { budgetMs: 3000 })).toEqual([null])
    expect(mockFindCommitsInWindow).not.toHaveBeenCalled()
  })

  it('looks nothing up for a folder outside a repo, or a window with no folder', () => {
    mockGetRepoRoot.mockReturnValue(null)

    expect(lookupDayCommits([MORNING, { ...WEB, cwd: null }], { budgetMs: 3000 })).toEqual([null, null])
    expect(mockFindCommitsInWindow).not.toHaveBeenCalled()
    expect(mockGetRepoRoot).toHaveBeenCalledTimes(1)
  })

  it('tells each commit once when two projects in one git root overlap in a block: the earliest window takes it', () => {
    mockGetRepoRoot.mockReturnValue('/Users/dev/monorepo')
    mockGetUserEmail.mockReturnValue('dev@example.com')
    mockFindCommitsInWindow.mockReturnValue([
      { hash: 'a1b2c3d', subject: 'shared fix', committedAt: '2026-10-25T09:30:00.000Z' },
    ])
    const app = {
      cwd: '/Users/dev/monorepo/app',
      startedAt: '2026-10-25T09:00:00.000Z',
      endedAt: '2026-10-25T10:00:00.000Z',
    }
    const lib = {
      cwd: '/Users/dev/monorepo/lib',
      startedAt: '2026-10-25T09:10:00.000Z',
      endedAt: '2026-10-25T09:50:00.000Z',
    }

    const [appCommits, libCommits] = lookupDayCommits([app, lib], { budgetMs: 3000 })

    expect(mockFindCommitsInWindow).toHaveBeenCalledTimes(1)
    expect(appCommits?.map((commit) => commit.subject)).toEqual(['shared fix'])
    expect(libCommits).toEqual([])
  })

  it("says git wasn't asked when git can't answer", () => {
    gitRepos()
    mockFindCommitsInWindow.mockReturnValue(null)

    expect(lookupDayCommits([MORNING, AFTERNOON], { budgetMs: 3000 })).toEqual([null, null])
  })
})

describe('lookupDayCommits: what each commit changed', () => {
  const COMMITS = [
    { hash: 'a1b2c3d', subject: 'morning fix', committedAt: '2026-10-25T09:30:00.000Z' },
    { hash: 'e4f5a6b', subject: 'morning merge', committedAt: '2026-10-25T09:40:00.000Z' },
  ]

  it('tells each commit what it changed, from one more call for the whole repo', () => {
    gitRepos()
    mockFindCommitsInWindow.mockReturnValue(COMMITS)
    mockGetCommitSizes.mockReturnValue(new Map([['a1b2c3d', { files: 5, added: 86, removed: 31 }]]))

    const [morning] = lookupDayCommits([MORNING], { budgetMs: 3000 })

    expect(mockGetCommitSizes).toHaveBeenCalledTimes(1)
    expect(mockGetCommitSizes).toHaveBeenCalledWith('/Users/dev/api', ['a1b2c3d', 'e4f5a6b'], expect.any(Number))
    expect(morning).toEqual([{ ...COMMITS[0], size: { files: 5, added: 86, removed: 31 } }, COMMITS[1]])
  })

  it('tells the commits as they were when git cannot size them', () => {
    gitRepos()
    mockFindCommitsInWindow.mockReturnValue(COMMITS)
    mockGetCommitSizes.mockReturnValue(null)

    expect(lookupDayCommits([MORNING], { budgetMs: 3000 })).toEqual([COMMITS])
  })

  it('asks for no sizes when there are no commits, or the budget is spent', () => {
    gitRepos()
    mockFindCommitsInWindow.mockReturnValue([])
    lookupDayCommits([MORNING], { budgetMs: 3000 })
    expect(mockGetCommitSizes).not.toHaveBeenCalled()

    mockFindCommitsInWindow.mockReturnValue(COMMITS)
    const clock = [0, 0, 1000, 2000, 3000]
    const result = lookupDayCommits([MORNING], { budgetMs: 3000, now: () => clock.shift() ?? 9000 })

    expect(mockGetCommitSizes).not.toHaveBeenCalled()
    expect(result).toEqual([COMMITS])
  })

  it('gives the sizes at most half of the time left, so a slow one cannot take the next repository with it', () => {
    gitRepos()
    mockFindCommitsInWindow.mockReturnValue(COMMITS)
    mockGetCommitSizes.mockReturnValue(new Map())
    // Deadline at 3000; the git log calls take nothing, and 2000 are left when the sizes are asked for
    const clock = [0, 0, 0, 0, 1000]
    const now = () => clock.shift() ?? 9000

    lookupDayCommits([MORNING], { budgetMs: 3000, now })

    expect(mockGetCommitSizes).toHaveBeenCalledWith('/Users/dev/api', expect.any(Array), 1000)
  })

  it('gives git the time left for the sizes, never 0', () => {
    gitRepos()
    mockFindCommitsInWindow.mockReturnValue(COMMITS)
    mockGetCommitSizes.mockReturnValue(new Map())
    // Deadline at 3000; the clock ticks past each call, ending 1 ms short of it
    const clock = [0, 0, 1000, 2000, 2999]
    const now = () => clock.shift() ?? 9000

    lookupDayCommits([MORNING], { budgetMs: 3000, now })

    expect(mockGetCommitSizes).toHaveBeenCalledWith('/Users/dev/api', expect.any(Array), 1)
  })
})
