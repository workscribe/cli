import { describe, it, expect, vi } from 'vitest'
import { readsOfRows, type ReadPathResolver } from '../../src/summary/event-reads'
import type { EventRow } from '../../src/db/types'

function row(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 1,
    captured_at: '2026-11-24T09:00:00.000Z',
    command: 'cat src/a.ts',
    cwd: '/work/app',
    exit_code: 0,
    duration_ms: 5,
    repo_name: 'app',
    branch: 'main',
    category: 'exploring',
    metadata: '{"tool":"cat"}',
    source: 'claude-code',
    file_path: null,
    ...overrides,
  }
}

function resolver(overrides: Partial<ReadPathResolver> = {}): ReadPathResolver {
  return { repoRootOf: () => '/work/app', ignoredAmong: () => new Set(), ...overrides }
}

describe('readsOfRows', () => {
  it('reads the paths of exploring rows, by their position', () => {
    const rows = [row(), row({ category: 'testing', command: 'npm test' }), row({ command: 'ls src' })]

    expect(readsOfRows(rows, resolver())).toEqual(
      new Map([
        [0, ['src/a.ts']],
        [2, ['src']],
      ])
    )
  })

  it('reads nothing from a row that is not exploring, even if its command reads', () => {
    expect(readsOfRows([row({ category: 'other' })], resolver())).toEqual(new Map())
  })

  it('leaves out the paths git ignores', () => {
    const rows = [row({ command: 'cat src/a.ts src/gen.ts' })]
    const ignoring = resolver({ ignoredAmong: () => new Set(['src/gen.ts']) })

    expect(readsOfRows(rows, ignoring)).toEqual(new Map([[0, ['src/a.ts']]]))
  })

  it('names nothing for a row whose paths are all ignored', () => {
    const ignoring = resolver({ ignoredAmong: () => new Set(['src/a.ts']) })

    expect(readsOfRows([row()], ignoring)).toEqual(new Map())
  })

  it('names nothing for a repository git cannot check, and checks no other repository for it', () => {
    const rows = [row({ cwd: '/work/gone' }), row({ cwd: '/work/app', command: 'cat b.ts' })]
    const unverifiable = resolver({
      repoRootOf: (cwd) => (cwd === '/work/app' ? '/work/app' : '/work/gone'),
      ignoredAmong: (root) => (root === '/work/gone' ? null : new Set()),
    })

    expect(readsOfRows(rows, unverifiable)).toEqual(new Map([[1, ['b.ts']]]))
  })

  it('names nothing for a row whose folder has no repository', () => {
    expect(readsOfRows([row()], resolver({ repoRootOf: () => null }))).toEqual(new Map())
  })

  it('asks git once per repository, with every path of its rows', () => {
    const ignoredAmong = vi.fn(() => new Set<string>())
    const rows = [row(), row({ command: 'cat src/b.ts' }), row({ command: 'ls src' })]

    readsOfRows(rows, resolver({ ignoredAmong }))

    expect(ignoredAmong).toHaveBeenCalledTimes(1)
    expect(ignoredAmong).toHaveBeenCalledWith('/work/app', ['src/a.ts', 'src/b.ts', 'src'])
  })

  it('asks git nothing when no row read a path', () => {
    const ignoredAmong = vi.fn(() => new Set<string>())

    readsOfRows([row({ command: 'git status' }), row({ category: 'testing' })], resolver({ ignoredAmong }))

    expect(ignoredAmong).not.toHaveBeenCalled()
  })
})
