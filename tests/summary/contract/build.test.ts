import { describe, it, expect } from 'vitest'
import { buildEventsJson, buildSessionsJson, eventToJson, sessionToJson } from '../../../src/summary/contract/build'
import { SCHEMA_VERSION } from '../../../src/summary/contract/constants'
import { HOME, capturedRow, row, session } from './fixtures'

const NO_GIT = { repoPath: null, commits: [], othersSubjects: [] }
const OPTIONS = { location: { projects: {}, homeDir: HOME }, git: NO_GIT, includeCategories: [] }

// Pinned so an accidental rename or removal fails here — see the stability rule in SCHEMA_VERSION.
const EVENT_KEYS = ['capturedAt', 'category', 'durationMs', 'exitCode', 'metadata', 'source']
const SESSION_KEYS = [
  'branch',
  'commits',
  'cwd',
  'durationMinutes',
  'endedAt',
  'eventCount',
  'events',
  'key',
  'notes',
  'project',
  'repoName',
  'repoPath',
  'startedAt',
]

describe('eventToJson', () => {
  it.each([
    ['git commit -m "fix: token"', { message: 'fix: token' }],
    ['npm install bcrypt', { tool: 'npm', packages: ['bcrypt'] }],
    ['docker push myorg/api:latest', { tool: 'docker', image: 'myorg/api:latest' }],
    ['ssh deploy@prod.example.com', { target: 'deploy@prod.example.com' }],
    ['npx prisma migrate dev', { tool: 'prisma' }],
  ])('exposes the structured metadata of `%s` but never the command, cwd or file path', (command, expected) => {
    const json = eventToJson(capturedRow(command, { file_path: '/Users/dev/api/src/secret.ts' }))
    const serialized = JSON.stringify(json)

    expect(Object.keys(json).sort()).toEqual(EVENT_KEYS)
    expect(json.metadata).toMatchObject(expected)
    expect(serialized).not.toContain(command)
    expect(serialized).not.toContain('/Users/dev/api')
  })

  it('leaves out the file path and cwd of an IDE save', () => {
    const save = row({
      category: 'code_edit',
      command: '/Users/dev/api/src/auth.ts',
      file_path: '/Users/dev/api/src/auth.ts',
      source: 'vscode',
    })
    const json = eventToJson(save)

    expect(Object.keys(json).sort()).toEqual(EVENT_KEYS)
    expect(JSON.stringify(json)).not.toContain('/Users/dev/api')
  })

  it("keeps an AI session's commit subjects but not the command or cwd", () => {
    const session = row({
      category: 'ai_session',
      command: 'claude --resume abc',
      metadata: '{"tool":"claude","commits":["add refresh endpoint"]}',
      source: 'shell',
    })
    const json = eventToJson(session)

    expect(json.metadata).toEqual({ tool: 'claude', commits: ['add refresh endpoint'] })
    expect(JSON.stringify(json)).not.toContain('--resume')
    expect(JSON.stringify(json)).not.toContain('/Users/dev/api')
  })

  it('gives unclassified events a hint and strips hint and tool from their metadata', () => {
    const other = row({ category: 'other', metadata: '{"tool":"make","hint":"make deploy","target":"prod"}' })

    expect(eventToJson(other)).toEqual({
      capturedAt: '2026-10-25T09:00:00.000Z',
      category: 'other',
      metadata: { target: 'prod' },
      hint: 'make deploy',
      exitCode: 0,
      durationMs: 1200,
      source: 'shell',
    })
  })
})

describe('sessionToJson', () => {
  it('describes the session with the documented keys', () => {
    const json = sessionToJson(session([capturedRow('npm test')]), OPTIONS)

    expect(Object.keys(json).sort()).toEqual(SESSION_KEYS)
    expect(json).toMatchObject({
      key: 'api|2026-10-25T09:00:00.000Z',
      project: 'api',
      repoName: 'api',
      cwd: '/Users/dev/api',
      branch: 'feature/auth',
      eventCount: 1,
    })
  })

  it('names a session outside git by its directory, with no repo path', () => {
    const outside = session([capturedRow('npm test', { cwd: '/Users/dev/scripts', repo_name: null })], {
      repoName: null,
    })

    expect(sessionToJson(outside, OPTIONS)).toMatchObject({
      key: '|2026-10-25T09:00:00.000Z',
      project: '~/scripts',
      repoPath: null,
    })
  })

  it('merges git commits with captured ones and moves notes out of events', () => {
    const events = [
      capturedRow('git commit -m "fix: token"'),
      row({ category: 'note', metadata: '{"text":"blocked on creds"}' }),
    ]
    const git = {
      repoPath: '/Users/dev/api',
      commits: [{ hash: 'a1b2c3d', subject: 'fix: token' }],
      othersSubjects: [],
    }
    const json = sessionToJson(session(events), { ...OPTIONS, git })

    expect(json.repoPath).toBe('/Users/dev/api')
    expect(json.commits).toEqual([{ hash: 'a1b2c3d', subject: 'fix: token', source: 'git' }])
    expect(Object.keys(json.commits[0]).sort()).toEqual(['hash', 'source', 'subject'])
    expect(json.notes).toEqual(['blocked on creds'])
    expect(json.events.map((event) => event.category)).toEqual(['shipping'])
  })
})

describe('buildSessionsJson / buildEventsJson', () => {
  it('wraps sessions with the schema version, including an empty day (and pins its keys)', () => {
    expect(buildSessionsJson('2026-10-25', [])).toEqual({
      schemaVersion: SCHEMA_VERSION,
      date: '2026-10-25',
      sessions: [],
    })
  })

  it('counts filtered events in total and applies the limit to the list', () => {
    const rows = [
      capturedRow('npm test'),
      capturedRow('cat README.md'),
      capturedRow('npm run build'),
      capturedRow('npm test'),
    ]
    const json = buildEventsJson('2026-10-25', rows, { limit: 2, includeCategories: [] })

    expect(Object.keys(json).sort()).toEqual(['date', 'events', 'schemaVersion', 'total'])
    expect(json.total).toBe(3)
    expect(json.events).toHaveLength(2)
  })

  it('returns an empty list for a day with no events', () => {
    expect(buildEventsJson('2026-10-25', [], { includeCategories: [] })).toEqual({
      schemaVersion: SCHEMA_VERSION,
      date: '2026-10-25',
      total: 0,
      events: [],
    })
  })
})
