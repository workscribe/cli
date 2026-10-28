import { describe, it, expect, onTestFinished } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getFileCommits } from '../../src/summary/git-commits'

/** A real repo with commits by you and by someone else, to two files. Returns its resolved root. */
function scratchRepo(): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-file-commits-')))
  onTestFinished(() => fs.rmSync(root, { recursive: true, force: true }))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  const commit = (file: string, subject: string, email = 'me@example.com') => {
    fs.writeFileSync(path.join(root, file), `${subject}\n`)
    git('add', file)
    git('-c', `user.email=${email}`, '-c', 'user.name=Someone', 'commit', '-q', '-m', subject)
  }
  git('init', '-q', '-b', 'main')
  git('config', 'user.email', 'me@example.com')
  fs.mkdirSync(path.join(root, 'src'))
  commit('README.md', 'first readme edit')
  commit('src/index.ts', 'touch the code')
  commit('README.md', 'tighten readme copy')
  commit('README.md', 'their readme edit', 'other@example.com')
  return root
}

const windowAroundNow = () => ({
  since: new Date(Date.now() - 60_000).toISOString(),
  until: new Date(Date.now() + 60_000).toISOString(),
})

describe('getFileCommits — a real repo', () => {
  it("returns your commits that changed the file, oldest first, and the repo's root", () => {
    const root = scratchRepo()

    const result = getFileCommits({ filePath: path.join(root, 'README.md'), ...windowAroundNow(), budgetMs: 2000 })

    expect(result.repoRoot).toBe(root)
    expect(result.commits.map((commit) => commit.subject)).toEqual(['first readme edit', 'tighten readme copy'])
  })

  it('finds a file in a subfolder', () => {
    const root = scratchRepo()

    const result = getFileCommits({ filePath: path.join(root, 'src/index.ts'), ...windowAroundNow(), budgetMs: 2000 })

    expect(result.commits.map((commit) => commit.subject)).toEqual(['touch the code'])
  })

  it('has no commits outside the session window', () => {
    const root = scratchRepo()

    const result = getFileCommits({
      filePath: path.join(root, 'README.md'),
      since: '2020-01-01T09:00:00.000Z',
      until: '2020-01-01T10:00:00.000Z',
      budgetMs: 2000,
    })

    expect(result.commits).toEqual([])
  })

  it('has no repo and no commits for a file outside any repo, or in a folder that is gone', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-no-repo-'))
    onTestFinished(() => fs.rmSync(outside, { recursive: true, force: true }))

    expect(getFileCommits({ filePath: path.join(outside, 'notes.md'), ...windowAroundNow(), budgetMs: 2000 })).toEqual({
      repoRoot: null,
      commits: [],
    })
    expect(getFileCommits({ filePath: '/nonexistent/folder/file.ts', ...windowAroundNow(), budgetMs: 2000 })).toEqual({
      repoRoot: null,
      commits: [],
    })
  })
})

describe('getFileCommits — the time budget', () => {
  it('skips git entirely once the budget is spent', () => {
    const root = scratchRepo()

    expect(getFileCommits({ filePath: path.join(root, 'README.md'), ...windowAroundNow(), budgetMs: 0 })).toEqual({
      repoRoot: null,
      commits: [],
    })
  })

  it('keeps the root but skips the commit lookup when the budget runs out after finding it', () => {
    const root = scratchRepo()
    // The clock reads 0 for the deadline and the root lookup, then jumps past the deadline
    let reads = 0
    const now = () => (reads++ < 2 ? 0 : 10_000)

    const result = getFileCommits({ filePath: path.join(root, 'README.md'), ...windowAroundNow(), budgetMs: 2000, now })

    expect(result).toEqual({ repoRoot: root, commits: [] })
  })
})
