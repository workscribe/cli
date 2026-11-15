import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { insertEventRecord, type NewEvent } from '../../src/db/event-writer'
import { getAgentSessionsOfEvents } from '../../src/db/agent-sessions'
import type { EventMerge } from '../../src/capture/merge-rules'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const WORKSPACE = '/code/app'
const SUB_FOLDER = '/code/app/sub'
const FILE = '/code/app/a.ts'
const T0 = '2026-11-15T10:00:00.000Z'
const COPILOT = { source: 'copilot-vscode', sessionId: 'chat-1' }
const CURSOR = { source: 'cursor', sessionId: 'cursor-1' }
const CLAUDE = { source: 'claude-code', sessionId: 'claude-1' }

const SHELL_MERGE: EventMerge = { kind: 'shell-command', agentSources: ['copilot-vscode'] }
const AGENTS = ['claude-code', 'cursor', 'copilot-vscode']
const COPILOT_COMMAND: EventMerge = { kind: 'agent-command', sharesShell: true, agentSources: AGENTS }
const COPILOT_EDIT: EventMerge = { kind: 'agent-edit', sharesSaves: true, agentSources: AGENTS }
const IMPORTED_EDIT: EventMerge = { kind: 'agent-edit', sharesSaves: false, agentSources: AGENTS }
const SAVE_MERGE: EventMerge = { kind: 'editor-save', agentSources: ['copilot-vscode'] }
const IMPORTED_COMMAND: EventMerge = { kind: 'agent-command', sharesShell: false, agentSources: AGENTS }

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  return db
}

function secondsAfter(seconds: number): string {
  return new Date(Date.parse(T0) + seconds * 1000).toISOString()
}

function event(overrides: Partial<NewEvent> = {}): NewEvent {
  return {
    captured_at: T0,
    command: 'npm test',
    cwd: WORKSPACE,
    exit_code: null,
    duration_ms: null,
    repo_name: 'app',
    branch: 'main',
    category: 'testing',
    metadata: null,
    source: null,
    file_path: null,
    ...overrides,
  }
}

function editEvent(overrides: Partial<NewEvent> = {}): NewEvent {
  return event({
    command: FILE,
    category: 'code_edit',
    file_path: FILE,
    metadata: '{"linesAdded":4,"linesRemoved":1}',
    ...overrides,
  })
}

interface StoredRow {
  id: number
  captured_at: string
  command: string
  cwd: string
  exit_code: number | null
  duration_ms: number | null
  metadata: string | null
  source: string | null
  agent_session_id: number | null
}

function rows(db: DatabaseSync): StoredRow[] {
  return db.prepare('SELECT * FROM events ORDER BY id').all() as unknown as StoredRow[]
}

describe('a shell row and the agent command it ran', () => {
  const shellRow = () => event({ command: ' npm test', cwd: SUB_FOLDER, exit_code: 1, duration_ms: 900 })
  const agentCommand = (overrides: Partial<NewEvent> = {}) =>
    event({
      source: 'copilot-vscode',
      agentSession: COPILOT,
      captured_at: secondsAfter(6),
      merge: COPILOT_COMMAND,
      ...overrides,
    })

  it('shell first: one event with the agent source and session, the shell exit code and folder, and a clean command', () => {
    const db = database()
    insertEventRecord(db, { ...shellRow(), merge: SHELL_MERGE })
    insertEventRecord(db, agentCommand())

    const [stored, ...others] = rows(db)
    expect(others).toEqual([])
    expect(stored).toMatchObject({
      source: 'copilot-vscode',
      exit_code: 1,
      duration_ms: 900,
      cwd: SUB_FOLDER,
      command: 'npm test',
      captured_at: T0,
    })
    expect(getAgentSessionsOfEvents(db, [stored.id]).map((session) => session.sessionId)).toEqual(['chat-1'])
  })

  it('agent first: the shell row adds its real exit code and folder stays the first row’s', () => {
    const db = database()
    insertEventRecord(db, agentCommand({ captured_at: T0, exit_code: -1 }))
    insertEventRecord(db, { ...shellRow(), captured_at: secondsAfter(6), merge: SHELL_MERGE })

    const [stored, ...others] = rows(db)
    expect(others).toEqual([])
    expect(stored).toMatchObject({ source: 'copilot-vscode', exit_code: 1, duration_ms: 900, cwd: WORKSPACE })
    expect(stored.agent_session_id).not.toBeNull()
  })

  it('matches a multi-line command, and one with a redacted value', () => {
    const db = database()
    const command = 'deploy --token=[REDACTED]\nnpm test'
    insertEventRecord(db, { ...shellRow(), command: ` ${command}`, merge: SHELL_MERGE })
    insertEventRecord(db, agentCommand({ command }))

    expect(rows(db)).toHaveLength(1)
  })

  it('merges a shell row that arrives within the duplicate window, as it would have been dropped before', () => {
    const db = database()
    insertEventRecord(db, agentCommand({ captured_at: T0, cwd: SUB_FOLDER }))
    insertEventRecord(db, { ...shellRow(), captured_at: secondsAfter(2), merge: SHELL_MERGE })

    expect(rows(db)).toHaveLength(1)
    expect(rows(db)[0]).toMatchObject({ source: 'copilot-vscode', exit_code: 1 })
  })

  it('keeps a command that has a source of its own out of an agent’s row', () => {
    const db = database()
    insertEventRecord(db, agentCommand({ captured_at: T0, cwd: SUB_FOLDER }))
    insertEventRecord(db, { ...shellRow(), source: 'aider', captured_at: secondsAfter(2), merge: SHELL_MERGE })

    expect(rows(db)).toHaveLength(2)
  })

  it('keeps a person’s second run, after the window, as its own event', () => {
    const db = database()
    insertEventRecord(db, agentCommand({ captured_at: T0 }))
    insertEventRecord(db, { ...shellRow(), captured_at: secondsAfter(20), merge: SHELL_MERGE })

    expect(rows(db)).toHaveLength(2)
  })

  it('keeps a shell row from another folder, or for another command', () => {
    const db = database()
    insertEventRecord(db, agentCommand({ captured_at: T0 }))
    insertEventRecord(db, { ...shellRow(), cwd: '/code/other', captured_at: secondsAfter(5), merge: SHELL_MERGE })
    insertEventRecord(db, { ...shellRow(), command: 'npm run build', captured_at: secondsAfter(5), merge: SHELL_MERGE })

    expect(rows(db)).toHaveLength(3)
  })

  it('never lets an agent that doesn’t share the shell hook absorb a shell row', () => {
    const db = database()
    insertEventRecord(db, { ...shellRow(), cwd: WORKSPACE })
    insertEventRecord(db, agentCommand({ merge: IMPORTED_COMMAND }))

    expect(rows(db)).toHaveLength(2)
  })

  it('never replaces a real exit code with an unknown one', () => {
    const db = database()
    insertEventRecord(db, { ...shellRow(), merge: SHELL_MERGE })
    insertEventRecord(db, agentCommand({ exit_code: -1 }))

    expect(rows(db)[0].exit_code).toBe(1)
  })
})

describe('where a merged event is credited', () => {
  const project = (root: string) => ({
    identity: `local:${root}`,
    kind: 'local' as const,
    name: root.split('/').pop() ?? root,
    root,
  })
  const linked = (root: string, branch: string) => ({ project: project(root), branch, file: null })

  it('keeps the first row’s folder, project and branch when the agent reports the workspace', () => {
    const db = database()
    insertEventRecord(db, {
      ...event({ command: ' npm test', cwd: SUB_FOLDER, exit_code: 0, merge: SHELL_MERGE }),
      dimensions: linked(SUB_FOLDER, 'feat/sub'),
    })
    insertEventRecord(db, {
      ...event({
        source: 'copilot-vscode',
        agentSession: COPILOT,
        captured_at: secondsAfter(6),
        merge: COPILOT_COMMAND,
      }),
      dimensions: linked(WORKSPACE, 'main'),
    })

    const [stored, ...others] = db
      .prepare('SELECT cwd, source, project_id, branch_id FROM events')
      .all() as unknown as { cwd: string; source: string; project_id: number; branch_id: number }[]
    expect(others).toEqual([])
    expect(stored).toMatchObject({ cwd: SUB_FOLDER, source: 'copilot-vscode' })
    const projectRoot = db.prepare('SELECT identity FROM project WHERE id = ?').get(stored.project_id) as {
      identity: string
    }
    expect(projectRoot.identity).toBe(`local:${SUB_FOLDER}`)
    expect(db.prepare('SELECT COUNT(*) AS count FROM project').get()).toEqual({ count: 1 })
  })
})

describe('an agent edit and the save it caused', () => {
  const save = (overrides: Partial<NewEvent> = {}) =>
    editEvent({ source: 'vscode', metadata: null, merge: SAVE_MERGE, captured_at: secondsAfter(0.15), ...overrides })
  const agentEdit = (overrides: Partial<NewEvent> = {}) =>
    editEvent({ source: 'copilot-vscode', agentSession: COPILOT, merge: COPILOT_EDIT, ...overrides })

  it('edit first: the save is part of the edit, which keeps its counts', () => {
    const db = database()
    insertEventRecord(db, agentEdit())
    insertEventRecord(db, save())

    expect(rows(db)).toHaveLength(1)
    expect(rows(db)[0]).toMatchObject({ source: 'copilot-vscode', metadata: '{"linesAdded":4,"linesRemoved":1}' })
  })

  it('save first: one event with the agent source, session and counts, at the save’s time', () => {
    const db = database()
    insertEventRecord(db, save({ captured_at: T0 }))
    insertEventRecord(db, agentEdit({ captured_at: secondsAfter(0.15) }))

    const [stored, ...others] = rows(db)
    expect(others).toEqual([])
    expect(stored).toMatchObject({ source: 'copilot-vscode', captured_at: T0 })
    expect(JSON.parse(stored.metadata ?? '')).toMatchObject({ linesAdded: 4, linesRemoved: 1 })
    expect(stored.agent_session_id).not.toBeNull()
  })

  it('keeps a person’s own save right after the agent’s edit as its own event', () => {
    const db = database()
    insertEventRecord(db, agentEdit())
    insertEventRecord(db, save({ captured_at: secondsAfter(3) }))

    expect(rows(db)).toHaveLength(2)
  })

  it('keeps a save that comes minutes later', () => {
    const db = database()
    insertEventRecord(db, agentEdit())
    insertEventRecord(db, save({ captured_at: secondsAfter(120) }))

    expect(rows(db)).toHaveLength(2)
  })

  it('measures from the latest edit of a repeated edit, not the event’s own time', () => {
    const db = database()
    insertEventRecord(
      db,
      agentEdit({ metadata: '{"linesAdded":4,"linesRemoved":1,"lastEditAt":"2026-11-15T10:00:20.000Z"}' })
    )
    insertEventRecord(db, save({ captured_at: secondsAfter(20.15) }))

    expect(rows(db)).toHaveLength(1)
  })

  it('never takes another agent’s edit with no conversation id for the save of this one', () => {
    const db = database()
    insertEventRecord(db, editEvent({ source: 'cursor', metadata: null, merge: IMPORTED_EDIT }))
    insertEventRecord(db, agentEdit({ captured_at: secondsAfter(0.15) }))

    expect(rows(db).map((row) => row.source)).toEqual(['cursor', 'copilot-vscode'])
  })

  it('merges nothing for an agent that doesn’t share the editor’s saves', () => {
    const db = database()
    insertEventRecord(db, agentEdit())
    insertEventRecord(db, save({ merge: { kind: 'editor-save', agentSources: ['cursor'] } }))

    expect(rows(db)).toHaveLength(2)
  })
})

describe('the imported Claude Code hook', () => {
  const importedCommand = (overrides: Partial<NewEvent> = {}) =>
    event({ source: 'claude-code', agentSession: CLAUDE, merge: IMPORTED_COMMAND, ...overrides })
  const cursorCommand = (overrides: Partial<NewEvent> = {}) =>
    event({ source: 'cursor', agentSession: CURSOR, merge: IMPORTED_COMMAND, ...overrides })

  it('is dropped when the agent’s own event came first', () => {
    const db = database()
    insertEventRecord(db, cursorCommand())
    insertEventRecord(db, importedCommand({ captured_at: secondsAfter(1) }))

    expect(rows(db).map((row) => row.source)).toEqual(['cursor'])
  })

  it('is taken over when it came first: no claude-code event remains', () => {
    const db = database()
    insertEventRecord(db, importedCommand())
    insertEventRecord(db, cursorCommand({ captured_at: secondsAfter(1), exit_code: 0 }))

    const [stored, ...others] = rows(db)
    expect(others).toEqual([])
    expect(stored).toMatchObject({ source: 'cursor', exit_code: 0 })
    expect(getAgentSessionsOfEvents(db, [stored.id]).map((session) => session.source)).toEqual(['cursor'])
  })

  it('stays when a person really ran Claude Code (nothing from another agent)', () => {
    const db = database()
    insertEventRecord(db, importedCommand())

    expect(rows(db).map((row) => row.source)).toEqual(['claude-code'])
  })

  it('is dropped for an edit too, and takes an edit over', () => {
    const db = database()
    const cursorEdit = editEvent({
      source: 'cursor',
      agentSession: CURSOR,
      merge: IMPORTED_EDIT,
    })
    const claudeEdit = editEvent({
      source: 'claude-code',
      agentSession: CLAUDE,
      merge: IMPORTED_EDIT,
      captured_at: secondsAfter(1),
    })
    insertEventRecord(db, cursorEdit)
    insertEventRecord(db, claudeEdit)
    expect(rows(db).map((row) => row.source)).toEqual(['cursor'])

    const other = database()
    insertEventRecord(other, { ...claudeEdit, captured_at: T0 })
    insertEventRecord(other, { ...cursorEdit, captured_at: secondsAfter(1) })
    expect(rows(other).map((row) => row.source)).toEqual(['cursor'])
  })

  it('drops the imported hook’s copy of an action from an agent that gave no conversation id', () => {
    const db = database()
    insertEventRecord(db, cursorCommand({ agentSession: undefined }))
    insertEventRecord(db, importedCommand({ captured_at: secondsAfter(1) }))

    expect(rows(db).map((row) => row.source)).toEqual(['cursor'])
  })

  it('leaves the conversation row of a taken-over claude-code event, unreferenced, until undo or clear', () => {
    const db = database()
    insertEventRecord(db, importedCommand())
    insertEventRecord(db, cursorCommand({ captured_at: secondsAfter(1) }))

    const sessions = db.prepare('SELECT id, source FROM agent_sessions ORDER BY id').all() as {
      id: number
      source: string
    }[]
    const referenced = rows(db).map((row) => row.agent_session_id)
    expect(sessions.map((session) => session.source)).toEqual(['claude-code', 'cursor'])
    expect(referenced).not.toContain(sessions[0].id)
  })

  it('never takes a person’s save for another agent’s copy of Claude Code’s edit', () => {
    const db = database()
    insertEventRecord(db, editEvent({ source: 'vscode', metadata: null }))
    insertEventRecord(
      db,
      editEvent({ source: 'claude-code', agentSession: CLAUDE, merge: IMPORTED_EDIT, captured_at: secondsAfter(2) })
    )

    expect(rows(db).map((row) => row.source)).toEqual(['vscode', 'claude-code'])
  })

  it('does not merge actions further apart than the window', () => {
    const db = database()
    insertEventRecord(db, cursorCommand())
    insertEventRecord(db, importedCommand({ captured_at: secondsAfter(10) }))

    expect(rows(db)).toHaveLength(2)
  })
})

describe('two connections to one database', () => {
  it('one capture after the other still leaves one event', () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-event-merge-'))
    const file = path.join(directory, 'workscribe.db')
    const first = new DatabaseSync(file)
    const second = new DatabaseSync(file)
    onTestFinished(() => {
      first.close()
      second.close()
      fs.rmSync(directory, { recursive: true, force: true })
    })
    first.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON')
    applyMigrations(first, MIGRATIONS)

    insertEventRecord(first, event({ source: 'copilot-vscode', agentSession: COPILOT, merge: COPILOT_COMMAND }))
    insertEventRecord(second, { ...event({ command: ' npm test', exit_code: 0 }), merge: SHELL_MERGE })

    expect(rows(first)).toHaveLength(1)
    expect(rows(first)[0]).toMatchObject({ source: 'copilot-vscode', exit_code: 0 })
  })
})
