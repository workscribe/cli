import { describe, it, expect } from 'vitest'
import {
  blockToJson,
  buildEventsJson,
  buildSessionsJson,
  eventToJson,
  threadToJson,
} from '../../../src/summary/contract/build'
import { EVENTS_SCHEMA_VERSION, SESSIONS_SCHEMA_VERSION } from '../../../src/summary/contract/constants'
import { HOME, block, capturedRow, row, thread } from './fixtures'

const NO_GIT = { repoPath: null, commits: [], othersSubjects: [] }
const OPTIONS = { location: { projects: {}, homeDir: HOME }, git: NO_GIT, includeCategories: [] }

// Pinned so an accidental rename or removal fails here — see the stability rule in contract/constants.ts.
const EVENT_KEYS = ['capturedAt', 'category', 'durationMs', 'exitCode', 'metadata', 'source']
const SESSION_KEYS = [
  'activeMinutes',
  'agentSessions',
  'alongside',
  'blockId',
  'branch',
  'branches',
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
  'tickets',
]
const BLOCK_KEYS = ['activeMinutes', 'endedAt', 'eventCount', 'id', 'startedAt', 'threadKeys']

/** A thread alone in its block. */
function soloThreadToJson(events: Parameters<typeof thread>[0], overrides: Parameters<typeof thread>[1] = {}) {
  const member = thread(events, overrides)
  return threadToJson(member, block([member]), OPTIONS)
}

describe('eventToJson', () => {
  it('keeps the agent session out of the event, whose keys are pinned', () => {
    const json = eventToJson(capturedRow('npm test', { agent_session_id: 7 }))

    expect(json).not.toHaveProperty('agentSessionId')
    expect(Object.keys(json)).not.toContain('agent_session_id')
  })

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

describe('threadToJson', () => {
  it('describes the thread with the documented keys', () => {
    const json = soloThreadToJson([capturedRow('npm test')])

    expect(Object.keys(json).sort()).toEqual(SESSION_KEYS)
    expect(json).toMatchObject({
      key: 'api|2026-10-25T09:00:00.000Z',
      project: 'api',
      repoName: 'api',
      cwd: '/Users/dev/api',
      branch: 'feature/auth',
      branches: ['feature/auth'],
      durationMinutes: 60,
      activeMinutes: 30,
      eventCount: 1,
      blockId: 1,
      alongside: [],
      agentSessions: [],
      tickets: [],
    })
  })

  it('lists every branch the thread touched, with branch the latest of them', () => {
    const events = [
      capturedRow('npm test', { branch: 'main' }),
      capturedRow('npm test', { branch: 'feat/x' }),
      capturedRow('npm test', { branch: 'main' }),
      capturedRow('npm test', { branch: 'fix/typo' }),
      capturedRow('npm test', { branch: null }),
    ]

    expect(soloThreadToJson(events)).toMatchObject({
      branch: 'fix/typo',
      branches: ['main', 'feat/x', 'fix/typo'],
    })
  })

  it('names the "elsewhere" thread by its directory, with no repo name or path', () => {
    const json = soloThreadToJson([capturedRow('npm test', { cwd: '/Users/dev/scripts', repo_name: null })], {
      projectId: null,
      repoName: null,
      key: '|2026-10-25T09:00:00.000Z',
    })

    expect(json).toMatchObject({
      key: '|2026-10-25T09:00:00.000Z',
      project: '~/scripts',
      repoName: null,
      repoPath: null,
    })
  })

  it("names the block's other threads alongside it, by key, in block order", () => {
    const cli = thread([capturedRow('npm test')], { id: 1, key: 'cli|2026-10-28T12:09:00.000Z' })
    const vscode = thread([capturedRow('npm test')], { id: 2, key: 'vscode|2026-10-28T12:15:00.000Z' })
    const site = thread([capturedRow('npm test')], { id: 3, key: 'landing-page|2026-10-28T12:30:00.000Z' })
    const day = block([cli, vscode, site], { id: 7 })

    expect(threadToJson(vscode, day, OPTIONS)).toMatchObject({
      blockId: 7,
      alongside: ['cli|2026-10-28T12:09:00.000Z', 'landing-page|2026-10-28T12:30:00.000Z'],
    })
  })

  it('lists the agent sessions the thread came from, never their working folder', () => {
    const agentSessions = [
      {
        source: 'claude-code',
        sessionId: 'abc-123',
        startedAt: '2026-10-25T09:00:00.000Z',
        lastSeenAt: '2026-10-25T09:40:00.000Z',
      },
    ]
    const json = soloThreadToJson([capturedRow('npm test')], {
      agentSessions: [{ ...agentSessions[0], cwd: '/Users/dev/secret' } as (typeof agentSessions)[0]],
    })

    expect(json.agentSessions).toEqual(agentSessions)
    expect(JSON.stringify(json)).not.toContain('/Users/dev/secret')
  })

  it('merges git commits with captured ones and moves notes out of events', () => {
    const events = [
      capturedRow('git commit -m "fix: token"'),
      row({ category: 'note', metadata: '{"text":"blocked on creds"}' }),
    ]
    const git = {
      repoPath: '/Users/dev/api',
      commits: [{ hash: 'a1b2c3d', subject: 'fix: token', committedAt: '2026-10-25T09:20:00+01:00' }],
      othersSubjects: [],
    }
    const member = thread(events)
    const json = threadToJson(member, block([member]), { ...OPTIONS, git })

    expect(json.repoPath).toBe('/Users/dev/api')
    expect(json.commits).toEqual([
      { hash: 'a1b2c3d', subject: 'fix: token', committedAt: '2026-10-25T09:20:00+01:00', source: 'git' },
    ])
    expect(Object.keys(json.commits[0]).sort()).toEqual(['committedAt', 'hash', 'source', 'subject'])
    expect(json.notes).toEqual(['blocked on creds'])
    expect(json.events.map((event) => event.category)).toEqual(['shipping'])
  })
})

describe('blockToJson', () => {
  it("describes the block with the documented keys and its threads' keys", () => {
    const cli = thread([capturedRow('npm test')], { id: 1, key: 'cli|2026-10-28T12:09:00.000Z' })
    const site = thread([capturedRow('npm test')], { id: 2, key: 'landing-page|2026-10-28T12:30:00.000Z' })
    const json = blockToJson(block([cli, site], { id: 7 }))

    expect(Object.keys(json).sort()).toEqual(BLOCK_KEYS)
    expect(json).toEqual({
      id: 7,
      startedAt: '2026-10-25T09:00:00.000Z',
      endedAt: '2026-10-25T10:00:00.000Z',
      eventCount: 2,
      activeMinutes: 40,
      threadKeys: ['cli|2026-10-28T12:09:00.000Z', 'landing-page|2026-10-28T12:30:00.000Z'],
    })
  })
})

describe('buildSessionsJson / buildEventsJson', () => {
  it('wraps blocks and sessions with version 2, including an empty day (and pins its keys)', () => {
    expect(SESSIONS_SCHEMA_VERSION).toBe(2)
    expect(buildSessionsJson('2026-10-25', [], [])).toEqual({
      schemaVersion: 2,
      date: '2026-10-25',
      blocks: [],
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
    expect(EVENTS_SCHEMA_VERSION).toBe(1)
    expect(buildEventsJson('2026-10-25', [], { includeCategories: [] })).toEqual({
      schemaVersion: 1,
      date: '2026-10-25',
      total: 0,
      events: [],
    })
  })
})
