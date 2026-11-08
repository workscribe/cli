import { describe, it, expect } from 'vitest'
import { buildFileDetails, displayPath } from '../../src/summary/file-details'
import type { EventRow } from '../../src/db/types'

const ROOT = '/Users/dev/api'
const FILE = `${ROOT}/README.md`

function save(filePath: string, capturedAt: string, branch: string | null = 'main'): EventRow {
  return {
    id: 0,
    captured_at: capturedAt,
    command: filePath,
    cwd: ROOT,
    exit_code: null,
    duration_ms: null,
    repo_name: 'api',
    branch,
    category: 'code_edit',
    metadata: null,
    source: 'vscode',
    file_path: filePath,
  }
}

const relativeToRoot = (storedPath: string) => displayPath(storedPath, ROOT)

function details(sessionEvents: EventRow[], sessionBranch: string | null = 'main') {
  return buildFileDetails({ filePath: FILE, sessionEvents, sessionBranch, commits: [], displayPathOf: relativeToRoot })
}

describe('buildFileDetails', () => {
  it("summarises the file's saves in the session", () => {
    const result = details([
      save(FILE, '2026-10-28T09:10:00.000Z'),
      save(`${ROOT}/src/a.ts`, '2026-10-28T09:15:00.000Z'),
      save(FILE, '2026-10-28T09:40:00.000Z', 'feat/docs'),
    ])

    expect(result).toEqual({
      path: FILE,
      relativePath: 'README.md',
      firstSavedAt: '2026-10-28T09:10:00.000Z',
      lastSavedAt: '2026-10-28T09:40:00.000Z',
      saveCount: 2,
      branch: 'feat/docs',
      commits: [],
      editedAlongside: { files: ['src/a.ts'], total: 1 },
    })
  })

  it("reports a merged save's latest edit as when the file was last saved", () => {
    const merged = {
      ...save(FILE, '2026-10-28T09:40:00.000Z'),
      metadata: '{"linesAdded":4,"linesRemoved":0,"lastEditAt":"2026-10-28T09:40:25.000Z"}',
    }

    expect(details([save(FILE, '2026-10-28T09:10:00.000Z'), merged])).toMatchObject({
      firstSavedAt: '2026-10-28T09:10:00.000Z',
      lastSavedAt: '2026-10-28T09:40:25.000Z',
      saveCount: 2,
    })
  })

  it('orders tied other files by their latest edit', () => {
    const earlier = `${ROOT}/src/b.ts`
    const later = `${ROOT}/src/c.ts`
    const result = details([
      save(FILE, '2026-10-28T09:00:00.000Z'),
      { ...save(earlier, '2026-10-28T09:05:00.000Z'), metadata: '{"lastEditAt":"2026-10-28T09:05:20.000Z"}' },
      save(later, '2026-10-28T09:05:10.000Z'),
    ])

    expect(result?.editedAlongside.files).toEqual(['src/b.ts', 'src/c.ts'])
  })

  it("falls back to the session's branch when the saves have none", () => {
    expect(details([save(FILE, '2026-10-28T09:10:00.000Z', null)], 'main')?.branch).toBe('main')
  })

  it('names the five most-saved other files, most recent first on a tie, and counts the rest', () => {
    const others = ['b', 'c', 'd', 'e', 'f', 'g'].map((name) => `${ROOT}/src/${name}.ts`)
    const result = details([
      save(FILE, '2026-10-28T09:00:00.000Z'),
      ...others.map((other, index) => save(other, `2026-10-28T09:0${index + 1}:00.000Z`)),
      save(others[5], '2026-10-28T09:30:00.000Z'), // g: saved twice
    ])

    expect(result?.editedAlongside).toEqual({
      files: ['src/g.ts', 'src/f.ts', 'src/e.ts', 'src/d.ts', 'src/c.ts'],
      total: 6,
    })
  })

  it('ignores events that carry a path but are not saves', () => {
    const task = { ...save(`${ROOT}/src/other.ts`, '2026-10-28T09:20:00.000Z'), category: 'task_run' }
    const notASave = { ...save(FILE, '2026-10-28T09:30:00.000Z'), category: 'debug_start' }

    expect(details([save(FILE, '2026-10-28T09:10:00.000Z'), task, notASave])).toMatchObject({
      saveCount: 1,
      lastSavedAt: '2026-10-28T09:10:00.000Z',
      editedAlongside: { files: [], total: 0 },
    })
  })

  it('is null when the session has no saves of the file', () => {
    expect(details([save(`${ROOT}/src/a.ts`, '2026-10-28T09:10:00.000Z')])).toBeNull()
  })
})

describe('displayPath', () => {
  it('is relative to the repo root for a file inside it', () => {
    expect(displayPath(`${ROOT}/src/index.ts`, ROOT)).toBe('src/index.ts')
  })

  it("is the file's name outside the repo, or without a root", () => {
    expect(displayPath('/Users/dev/other/notes.md', ROOT)).toBe('notes.md')
    expect(displayPath('/Users/dev/api-old/notes.md', ROOT)).toBe('notes.md')
    expect(displayPath(`${ROOT}/src/index.ts`, null)).toBe('index.ts')
  })
})
