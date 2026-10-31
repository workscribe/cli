import { describe, it, expect, vi, onTestFinished } from 'vitest'

vi.mock('../../src/db', () => ({ getLatestFileSaveAt: vi.fn() }))
vi.mock('../../src/sessions/detector', () => ({ ensureDayGrouped: vi.fn() }))
vi.mock('../../src/summary/git-commits', () => ({ getFileCommits: vi.fn() }))

import fs from 'fs'
import os from 'os'
import path from 'path'
import * as db from '../../src/db'
import { ensureDayGrouped } from '../../src/sessions/detector'
import { getFileCommits } from '../../src/summary/git-commits'
import { localDateOf } from '../../src/utils/format'
import { GIT_BUDGET_MS, LOCK_WAIT_MS, getFileDetails, groupDayOfLatestSave } from '../../src/cli/context-file'
import type { EventRow } from '../../src/db/types'

const mocked = vi.mocked(db)
const spanOf = (events: EventRow[]) => ({
  events,
  branch: 'main',
  startedAt: '2026-10-28T09:00:00.000Z',
  endedAt: '2026-10-28T10:00:00.000Z',
})

function lockedError(): Error {
  return Object.assign(new Error('database is locked'), { code: 'ERR_SQLITE_ERROR', errcode: 5 })
}

describe('groupDayOfLatestSave', () => {
  it("groups the local day of the file's latest save, with the short lock wait", () => {
    mocked.getLatestFileSaveAt.mockReturnValue('2026-10-28T09:40:00.000Z')

    groupDayOfLatestSave('/repo/README.md')

    expect(ensureDayGrouped).toHaveBeenCalledWith(localDateOf('2026-10-28T09:40:00.000Z'), { lockWaitMs: LOCK_WAIT_MS })
  })

  it('does nothing for a file never saved in an editor', () => {
    mocked.getLatestFileSaveAt.mockReturnValue(null)
    groupDayOfLatestSave('/repo/README.md')
    expect(ensureDayGrouped).not.toHaveBeenCalled()
  })

  it('answers from the sessions as they are when another process holds the lock', () => {
    mocked.getLatestFileSaveAt.mockReturnValue('2026-10-28T09:40:00.000Z')
    vi.mocked(ensureDayGrouped).mockImplementation(() => {
      throw lockedError()
    })

    expect(() => groupDayOfLatestSave('/repo/README.md')).not.toThrow()
  })

  it('still reports any other database error', () => {
    mocked.getLatestFileSaveAt.mockReturnValue('2026-10-28T09:40:00.000Z')
    vi.mocked(ensureDayGrouped).mockImplementation(() => {
      throw new Error('no such table: sessions')
    })

    expect(() => groupDayOfLatestSave('/repo/README.md')).toThrow('no such table')
  })
})

describe('getFileDetails — a repo opened through a symlink', () => {
  it('shows paths relative to the repo, never ../, and gives git the resolved file', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-context-file-')))
    onTestFinished(() => fs.rmSync(base, { recursive: true, force: true }))
    const realRoot = path.join(base, 'real', 'api')
    fs.mkdirSync(path.join(realRoot, 'src'), { recursive: true })
    fs.writeFileSync(path.join(realRoot, 'README.md'), '')
    fs.writeFileSync(path.join(realRoot, 'src', 'a.ts'), '')
    fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'))
    const linkedFile = path.join(base, 'link', 'api', 'README.md')
    const linkedOther = path.join(base, 'link', 'api', 'src', 'a.ts')

    vi.mocked(getFileCommits).mockReturnValue({
      repoRoot: realRoot,
      commits: [{ hash: 'a1b2c3d', subject: 'docs', committedAt: '2026-10-25T09:20:00+01:00' }],
    })
    const saveOf = (filePath: string, capturedAt: string) => ({
      id: 1,
      captured_at: capturedAt,
      command: filePath,
      cwd: path.dirname(filePath),
      exit_code: null,
      duration_ms: null,
      repo_name: 'api',
      branch: 'main',
      category: 'code_edit',
      metadata: null,
      source: 'vscode',
      file_path: filePath,
    })
    const span = spanOf([
      saveOf(linkedFile, '2026-10-28T09:10:00.000Z'),
      saveOf(linkedOther, '2026-10-28T09:20:00.000Z'),
    ])

    const details = getFileDetails(linkedFile, span)

    expect(getFileCommits).toHaveBeenCalledWith({
      filePath: path.join(realRoot, 'README.md'),
      since: span.startedAt,
      until: span.endedAt,
      budgetMs: GIT_BUDGET_MS,
    })
    expect(details).toMatchObject({
      path: linkedFile,
      relativePath: 'README.md',
      commits: [{ hash: 'a1b2c3d', subject: 'docs', committedAt: '2026-10-25T09:20:00+01:00' }],
      editedAlongside: { files: [path.join('src', 'a.ts')], total: 1 },
    })
  })
})

describe('getFileDetails — a save stored through a symlink', () => {
  it('counts it as a save of the same file asked about by its real path', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-context-link-')))
    onTestFinished(() => fs.rmSync(base, { recursive: true, force: true }))
    const realFile = path.join(base, 'real', 'README.md')
    fs.mkdirSync(path.dirname(realFile), { recursive: true })
    fs.writeFileSync(realFile, '')
    fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'))
    vi.mocked(getFileCommits).mockReturnValue({ repoRoot: path.dirname(realFile), commits: [] })
    const savedThroughLink = {
      id: 1,
      captured_at: '2026-10-28T09:10:00.000Z',
      command: 'README.md',
      cwd: path.join(base, 'link'),
      exit_code: null,
      duration_ms: null,
      repo_name: 'api',
      branch: 'main',
      category: 'code_edit',
      metadata: null,
      source: 'vscode',
      file_path: path.join(base, 'link', 'README.md'),
    }

    const details = getFileDetails(realFile, spanOf([savedThroughLink]))

    expect(details).toMatchObject({ saveCount: 1, relativePath: 'README.md', editedAlongside: { total: 0 } })
  })
})

describe('getFileDetails — a session found through something other than a save', () => {
  it('is null without spending any of the git budget', () => {
    const span = spanOf([
      {
        id: 1,
        captured_at: '2026-10-28T09:10:00.000Z',
        command: 'task',
        cwd: '/repo',
        exit_code: null,
        duration_ms: null,
        repo_name: 'api',
        branch: 'main',
        category: 'task_run',
        metadata: null,
        source: 'vscode',
        file_path: '/repo/README.md',
      },
    ])

    expect(getFileDetails('/repo/README.md', span)).toBeNull()
    expect(getFileCommits).not.toHaveBeenCalled()
  })
})
