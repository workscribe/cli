import { afterAll, beforeAll, describe, it, expect } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { createReadResolver } from '../../src/summary/read-resolver'

// Real git in real temporary folders: the point is what git itself answers, symlinked temp folders included
let repo = ''
let outside = ''

function write(relativePath: string, content = 'x'): void {
  const target = path.join(repo, relativePath)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, content)
}

beforeAll(() => {
  repo = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-reads-'))
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-no-repo-'))
  execFileSync('git', ['init', '-q'], { cwd: repo })
  write('.gitignore', 'ignored/\n*.log\n')
  write('src/a.ts')
  write('ignored/b.ts')
  write('debug.log')
  write('weird name.log')
})

afterAll(() => {
  fs.rmSync(repo, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

describe('createReadResolver: the repository of a folder', () => {
  it('names the repository from the repository itself and from a folder inside it, in the folder as given', () => {
    const resolver = createReadResolver()

    expect(resolver.repoRootOf(repo)).toBe(repo)
    expect(resolver.repoRootOf(path.join(repo, 'src'))).toBe(repo)
  })

  it('has no repository for a folder outside one, or one that is gone', () => {
    const resolver = createReadResolver()

    expect(resolver.repoRootOf(outside)).toBeNull()
    expect(resolver.repoRootOf(path.join(outside, 'missing'))).toBeNull()
  })
})

describe('createReadResolver: what git ignores', () => {
  it('names the ignored paths among those asked about, files and folders alike', () => {
    const resolver = createReadResolver()

    expect(resolver.ignoredAmong(repo, ['src/a.ts', 'ignored', 'ignored/b.ts', 'debug.log'])).toEqual(
      new Set(['ignored', 'ignored/b.ts', 'debug.log'])
    )
  })

  it('reads a path with a space, and one that looks like an option, as paths', () => {
    const resolver = createReadResolver()

    expect(resolver.ignoredAmong(repo, ['weird name.log', '--help', '-rf'])).toEqual(new Set(['weird name.log']))
  })

  it('says none is ignored with an empty set, not as "can\'t say"', () => {
    expect(createReadResolver().ignoredAmong(repo, ['src/a.ts'])).toEqual(new Set())
    expect(createReadResolver().ignoredAmong(repo, [])).toEqual(new Set())
  })

  it("can't say for a folder that isn't a repository", () => {
    expect(createReadResolver().ignoredAmong(outside, ['a.ts'])).toBeNull()
    expect(createReadResolver().ignoredAmong(path.join(outside, 'missing'), ['a.ts'])).toBeNull()
  })
})

describe('createReadResolver: the budget', () => {
  it('answers "can\'t say" to everything once the budget is spent, and asks git nothing', () => {
    let clock = 0
    const resolver = createReadResolver(100, () => clock)
    expect(resolver.repoRootOf(repo)).toBe(repo)

    clock = 101

    expect(resolver.repoRootOf(path.join(repo, 'src'))).toBeNull()
    expect(resolver.ignoredAmong(repo, ['debug.log'])).toBeNull()
  })

  it('remembers the answer for a folder it has already asked about', () => {
    let clock = 0
    const resolver = createReadResolver(100, () => clock)
    expect(resolver.repoRootOf(repo)).toBe(repo)

    clock = 101

    expect(resolver.repoRootOf(repo)).toBe(repo)
  })
})
