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
      editorSaves: 2,
      agentEdits: 0,
      linesAdded: null,
      linesRemoved: null,
      changedBy: [{ source: 'vscode', agent: null, count: 2, linesAdded: null, linesRemoved: null }],
      agentSessions: [],
    })
  })

  describe('who changed the file', () => {
    const edit = (source: string, counts: object | null, agentSessionId?: number): EventRow => ({
      ...save(FILE, '2026-10-28T09:10:00.000Z'),
      source,
      metadata: counts === null ? null : JSON.stringify(counts),
      agent_session_id: agentSessionId,
    })
    const agentSession = {
      id: 7,
      source: 'claude-code',
      sessionId: 'abc',
      startedAt: '2026-10-28T09:00:00.000Z',
      lastSeenAt: '2026-10-28T10:00:00.000Z',
      endedAt: null,
      recap: 'Fixed the readme',
    }

    it('tells editor saves and agent edits apart, with line counts', () => {
      const result = details([
        edit('vscode', { linesAdded: 4, linesRemoved: 1 }),
        edit('claude-code', { linesAdded: 10, linesRemoved: null }, 7),
        edit('claude-code', { linesAdded: 2, linesRemoved: 2 }, 7),
      ])

      expect(result).toMatchObject({
        saveCount: 3,
        editorSaves: 1,
        agentEdits: 2,
        linesAdded: 16,
        linesRemoved: 3,
        changedBy: [
          { source: 'vscode', agent: null, count: 1, linesAdded: 4, linesRemoved: 1 },
          { source: 'claude-code', agent: 'Claude Code', count: 2, linesAdded: 12, linesRemoved: 2 },
        ],
      })
    })

    it('tells the agent sessions that edited it, with the recap only when asked', () => {
      const events = [edit('claude-code', null, 7)]
      const withoutRecap = buildFileDetails({
        filePath: FILE,
        sessionEvents: events,
        sessionBranch: 'main',
        commits: [],
        displayPathOf: relativeToRoot,
        agentSessions: [agentSession],
      })
      const withRecap = buildFileDetails({
        filePath: FILE,
        sessionEvents: events,
        sessionBranch: 'main',
        commits: [],
        displayPathOf: relativeToRoot,
        agentSessions: [agentSession],
        showRecaps: true,
      })

      expect(withoutRecap?.agentSessions).toEqual([
        { source: 'claude-code', agent: 'Claude Code', startedAt: agentSession.startedAt, endedAt: null, recap: null },
      ])
      expect(withRecap?.agentSessions[0].recap).toBe('Fixed the readme')
    })

    it('leaves out agent sessions that did not edit it', () => {
      expect(details([edit('vscode', null)])?.agentSessions).toEqual([])
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
