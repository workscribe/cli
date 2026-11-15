import { describe, it, expect } from 'vitest'
import { buildHistory, isGitCommand } from '../../src/summary/history'
import { capturedRow } from './contract/fixtures'
import type { EventRow } from '../../src/db/types'

let nextId = 1
function run(command: string, overrides: Partial<EventRow> = {}): EventRow {
  const id = nextId++
  return capturedRow(command, {
    id,
    captured_at: `2026-11-10T09:${String(id).padStart(2, '0')}:00.000Z`,
    source: null,
    branch: 'main',
    ...overrides,
  })
}

describe('isGitCommand', () => {
  it.each(['git status', 'git -C app log', 'cd app && git commit -m x', 'npm test; git push'])(
    'reads %s as git',
    (command) => {
      expect(isGitCommand(command)).toBe(true)
    }
  )

  it.each(['echo git foo', 'npm test', 'gitk', 'grep git file'])('does not read %s as git', (command) => {
    expect(isGitCommand(command)).toBe(false)
  })
})

describe('buildHistory', () => {
  it('lists git commands from the shell and from an agent, in order, with their source', () => {
    const rows = [run('git status'), run('git commit -m "x"', { source: 'claude-code' }), run('npm test')]

    const { entries } = buildHistory(rows, { all: false })

    expect(entries.map((entry) => [entry.command, entry.source])).toEqual([
      ['git status', 'shell'],
      ['git commit -m "x"', 'Claude Code'],
    ])
  })

  it('adds the non-git commands with --all, without changing any move', () => {
    const rows = [
      run('git stash', { branch: 'main' }),
      run('npm test', { branch: 'main' }),
      run('git switch -c feat/x', { branch: 'feat/x' }),
      run('git stash pop', { branch: 'feat/x' }),
    ]

    const withAll = buildHistory(rows, { all: true })
    const gitOnly = buildHistory(rows, { all: false })

    expect(withAll.entries).toHaveLength(4)
    expect(gitOnly.entries).toHaveLength(3)
    expect(withAll.entries.filter((entry) => entry.isGit).map((entry) => entry.moves)).toEqual(
      gitOnly.entries.map((entry) => entry.moves)
    )
    expect(gitOnly.entries.flatMap((entry) => entry.moves)).toEqual([
      'Created feat/x from main',
      'Moved uncommitted changes from main to feat/x (git stash, then git stash pop)',
    ])
  })

  it('puts a recovery pointer next to a hard reset, and none next to a plain checkout of a file', () => {
    const [reset, checkout] = buildHistory([run('git reset --hard HEAD~1'), run('git checkout -- a.ts')], {
      all: false,
    }).entries

    expect(reset.recovery).toEqual([expect.stringContaining('git reflog')])
    expect(checkout.moves).toEqual(['Discarded changes to files (git checkout -- …)'])
    expect(checkout.recovery).toEqual([])
  })

  it('keeps the moves of a failed command out, and marks it failed', () => {
    const [entry] = buildHistory([run('git merge feat/y', { exit_code: 1 })], { all: false }).entries

    expect(entry.exitCode).toBe(1)
    expect(entry.moves).toEqual([])
    expect(entry.recovery).toEqual([])
  })

  it('ends with the stashes nobody restored', () => {
    expect(buildHistory([run('git stash')], { all: false }).leftStashed).toEqual(['Left changes stashed (git stash)'])
  })

  it('says a stash restored with no push in the window was restored', () => {
    const [entry] = buildHistory([run('git stash pop')], { all: false }).entries

    expect(entry.moves).toEqual(['Restored stashed changes (git stash pop)'])
  })
})
