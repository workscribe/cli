import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { getCommitSizes } from '../../src/summary/git-commits'

// Real git in a real temporary repository: the point is what git itself prints for a rename, a binary file and a merge
let repo = ''
const hashes: Record<string, string> = {}

function git(...args: string[]): string {
  return execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'test',
      GIT_AUTHOR_EMAIL: 'test@example.com',
      GIT_COMMITTER_NAME: 'test',
      GIT_COMMITTER_EMAIL: 'test@example.com',
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'commit.gpgsign',
      GIT_CONFIG_VALUE_0: 'false',
    },
  }).trim()
}

function commit(name: string, message: string): void {
  git('add', '.')
  git('commit', '-q', '-m', message)
  hashes[name] = git('log', '-1', '--format=%h')
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-sizes-'))
  git('init', '-q', '-b', 'main')
  fs.writeFileSync(path.join(repo, 'a.ts'), 'a\nb\nc\n')
  fs.writeFileSync(path.join(repo, 'b.txt'), 'x\n')
  commit('added', 'add two files')
  git('mv', 'a.ts', 'c.ts')
  fs.writeFileSync(path.join(repo, 'c.ts'), 'a\nb\nc\nd\n')
  commit('renamed', 'rename and extend')
  fs.writeFileSync(path.join(repo, 'bin.dat'), Buffer.from([0, 1, 2]))
  commit('binary', 'add a binary file')
  fs.writeFileSync(path.join(repo, 'b.txt'), 'changed\n')
  commit('edited', 'change a line')
  git('commit', '-q', '--allow-empty', '-m', 'empty')
  hashes.empty = git('log', '-1', '--format=%h')
  git('switch', '-q', '-c', 'side')
  fs.writeFileSync(path.join(repo, 's.txt'), 's\n')
  commit('side', 'work on a side branch')
  git('switch', '-q', 'main')
  fs.writeFileSync(path.join(repo, 'm.txt'), 'm\n')
  commit('main', 'work on main')
  git('merge', '-q', '--no-ff', 'side', '-m', 'merge the side branch')
  hashes.merge = git('log', '-1', '--format=%h')
})

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true })
})

describe('getCommitSizes', () => {
  it('counts the files and lines each commit changed', () => {
    const sizes = getCommitSizes(repo, [hashes.added, hashes.edited, hashes.main])

    expect(sizes?.get(hashes.added)).toEqual({ files: 2, added: 4, removed: 0 })
    expect(sizes?.get(hashes.edited)).toEqual({ files: 1, added: 1, removed: 1 })
    expect(sizes?.get(hashes.main)).toEqual({ files: 1, added: 1, removed: 0 })
  })

  it('counts a rename as one file', () => {
    expect(getCommitSizes(repo, [hashes.renamed])?.get(hashes.renamed)).toEqual({ files: 1, added: 1, removed: 0 })
  })

  it('counts a binary file as a file with no lines', () => {
    expect(getCommitSizes(repo, [hashes.binary])?.get(hashes.binary)).toEqual({ files: 1, added: 0, removed: 0 })
  })

  it('gives a merge no size: against its first parent it would be everything merged in', () => {
    const sizes = getCommitSizes(repo, [hashes.merge, hashes.main])

    expect(sizes?.has(hashes.merge)).toBe(false)
    expect(sizes?.has(hashes.main)).toBe(true)
  })

  it('gives a commit that changed no file no size', () => {
    expect(getCommitSizes(repo, [hashes.empty])?.has(hashes.empty)).toBe(false)
  })

  it('answers for several commits at once, and for none', () => {
    expect(getCommitSizes(repo, Object.values(hashes))?.size).toBe(6)
    expect(getCommitSizes(repo, [])).toEqual(new Map())
  })

  it('asks git about nothing that is not a hash', () => {
    const sizes = getCommitSizes(repo, ['--output=/tmp/x', hashes.added, 'HEAD~1', ''])

    expect([...(sizes?.keys() ?? [])]).toEqual([hashes.added])
  })

  it('cannot tell for a folder that is not a repository, or an unknown hash', () => {
    expect(getCommitSizes(path.join(repo, 'missing'), [hashes.added])).toBeNull()
    expect(getCommitSizes(repo, ['abcdef1'])).toBeNull()
  })

  it('splits a long list into batches inside one budget', () => {
    const many = Array.from({ length: 250 }, () => hashes.added)

    expect(getCommitSizes(repo, many)?.get(hashes.added)).toEqual({ files: 2, added: 4, removed: 0 })
  })
})
