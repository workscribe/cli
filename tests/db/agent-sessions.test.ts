import { describe, it, expect, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { insertEventRecord, type NewEvent } from '../../src/db/event-writer'
import {
  agentSessionIdsOfDate,
  agentSessionIdsOfEvents,
  clearAgentMessages,
  deleteEmptyAgentSessions,
  getAgentSessionsOfEvents,
  recordAgentMessage,
  recordAgentSessionEnd,
} from '../../src/db/agent-sessions'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const CONVERSATION = { source: 'claude-code', sessionId: 'conversation-1' }

function database(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  return db
}

function event(overrides: Partial<NewEvent> = {}): NewEvent {
  return {
    captured_at: '2026-10-31T09:00:00.000Z',
    command: 'npm test',
    cwd: '/code/api',
    exit_code: 0,
    duration_ms: 10,
    repo_name: 'api',
    branch: 'main',
    category: 'testing',
    metadata: null,
    source: 'claude-code',
    file_path: null,
    ...overrides,
  }
}

const sessions = (db: DatabaseSync) =>
  db.prepare('SELECT id, source, session_id, cwd, started_at, last_seen_at FROM agent_sessions').all()
const links = (db: DatabaseSync) =>
  (db.prepare('SELECT agent_session_id FROM events ORDER BY id').all() as { agent_session_id: number | null }[]).map(
    (row) => row.agent_session_id
  )

describe('agent sessions', () => {
  it("links one conversation's commands in two repos to one session, keeping where and when it started", () => {
    const db = database()

    insertEventRecord(db, event({ agentSession: CONVERSATION }))
    insertEventRecord(
      db,
      event({ cwd: '/code/web', repo_name: 'web', captured_at: '2026-10-31T09:20:00.000Z', agentSession: CONVERSATION })
    )

    expect(links(db)).toEqual([1, 1])
    expect(sessions(db)).toEqual([
      {
        id: 1,
        source: 'claude-code',
        session_id: 'conversation-1',
        cwd: '/code/api',
        started_at: '2026-10-31T09:00:00.000Z',
        last_seen_at: '2026-10-31T09:20:00.000Z',
      },
    ])
  })

  it('never moves the last-seen time back for an event that arrives out of order', () => {
    const db = database()
    insertEventRecord(db, event({ captured_at: '2026-10-31T10:00:00.000Z', agentSession: CONVERSATION }))

    insertEventRecord(db, event({ captured_at: '2026-10-31T09:00:00.000Z', agentSession: CONVERSATION }))

    expect(sessions(db)).toEqual([expect.objectContaining({ last_seen_at: '2026-10-31T10:00:00.000Z' })])
  })

  it('keeps the conversations of different agents and sessions apart', () => {
    const db = database()

    insertEventRecord(db, event({ agentSession: CONVERSATION }))
    insertEventRecord(db, event({ agentSession: { ...CONVERSATION, sessionId: 'conversation-2' } }))

    expect(links(db)).toEqual([1, 2])
  })

  it('links nothing for an event without a conversation — shell, editor and notes', () => {
    const db = database()

    insertEventRecord(db, event({ source: null }))

    expect(links(db)).toEqual([null])
    expect(sessions(db)).toEqual([])
  })

  it('links an agent command run outside any repo', () => {
    const db = database()

    insertEventRecord(db, event({ cwd: '/tmp', repo_name: null, agentSession: CONVERSATION }))

    expect(links(db)).toEqual([1])
  })

  it('stores the event without its session, rather than losing it, when the session write fails', () => {
    const db = database()
    db.exec("CREATE TRIGGER refuse BEFORE INSERT ON agent_sessions BEGIN SELECT RAISE(ABORT, 'disk on fire'); END")

    insertEventRecord(db, event({ agentSession: CONVERSATION }))

    expect(db.prepare('SELECT command, agent_session_id FROM events').all()).toEqual([
      { command: 'npm test', agent_session_id: null },
    ])
  })

  it("finds a local day's agent sessions, leaving out its events with none", () => {
    const db = database()
    insertEventRecord(db, event({ agentSession: CONVERSATION }))
    insertEventRecord(db, event({ agentSession: CONVERSATION }))
    insertEventRecord(db, event())
    const [{ date }] = db.prepare("SELECT date(captured_at, 'localtime') AS date FROM events LIMIT 1").all() as {
      date: string
    }[]

    expect(agentSessionIdsOfDate(db, date)).toEqual([1])
    expect(agentSessionIdsOfDate(db, '1999-01-01')).toEqual([])
  })

  it('deletes only the sessions left with no events, among those of the deleted events', () => {
    const db = database()
    insertEventRecord(db, event({ agentSession: CONVERSATION }))
    insertEventRecord(db, event({ agentSession: { ...CONVERSATION, sessionId: 'conversation-2' } }))
    insertEventRecord(db, event({ agentSession: { ...CONVERSATION, sessionId: 'conversation-2' } }))
    db.exec(
      "INSERT INTO agent_sessions (source, session_id, started_at, last_seen_at) VALUES ('claude-code', 'no-events-yet', 'x', 'x')"
    )

    const sessionIds = agentSessionIdsOfEvents(db, [1, 2])
    db.exec('DELETE FROM events WHERE id IN (1, 2)')
    deleteEmptyAgentSessions(db, sessionIds)

    expect(sessionIds).toEqual([1, 2])
    expect((sessions(db) as { session_id: string }[]).map((row) => row.session_id)).toEqual([
      'conversation-2',
      'no-events-yet',
    ])
  })
})

describe('how agent sessions end, and their messages', () => {
  const endings = (db: DatabaseSync) =>
    db.prepare('SELECT session_id, ended_at, end_reason, recap, compact_summary FROM agent_sessions').all()

  it('records when and why a session ended', () => {
    const db = database()
    insertEventRecord(db, event({ agentSession: CONVERSATION }))

    recordAgentSessionEnd(db, { ...CONVERSATION, endedAt: '2026-10-31T09:30:00.000Z', reason: 'other' })

    expect(endings(db)).toEqual([
      expect.objectContaining({ ended_at: '2026-10-31T09:30:00.000Z', end_reason: 'other' }),
    ])
  })

  it('keeps the latest recap and compaction summary apart', () => {
    const db = database()
    insertEventRecord(db, event({ agentSession: CONVERSATION }))

    recordAgentMessage(db, { ...CONVERSATION, kind: 'recap', text: 'first' })
    recordAgentMessage(db, { ...CONVERSATION, kind: 'recap', text: 'latest' })
    recordAgentMessage(db, { ...CONVERSATION, kind: 'compactSummary', text: 'summary' })

    expect(endings(db)).toEqual([expect.objectContaining({ recap: 'latest', compact_summary: 'summary' })])
  })

  it('forgets every recap and compaction summary, keeping the sessions', () => {
    const db = database()
    insertEventRecord(db, event({ agentSession: CONVERSATION }))
    recordAgentMessage(db, { ...CONVERSATION, kind: 'recap', text: 'latest' })
    recordAgentMessage(db, { ...CONVERSATION, kind: 'compactSummary', text: 'summary' })

    clearAgentMessages(db)

    expect(endings(db)).toEqual([expect.objectContaining({ recap: null, compact_summary: null })])
  })

  it('lists the session with its id, ending and recap for the events it came from', () => {
    const db = database()
    insertEventRecord(db, event({ agentSession: CONVERSATION }))
    recordAgentMessage(db, { ...CONVERSATION, kind: 'recap', text: 'latest' })
    recordAgentSessionEnd(db, { ...CONVERSATION, endedAt: '2026-10-31T09:30:00.000Z', reason: 'other' })

    expect(getAgentSessionsOfEvents(db, [1])).toEqual([
      expect.objectContaining({ id: 1, endedAt: '2026-10-31T09:30:00.000Z', recap: 'latest' }),
    ])
  })

  it('creates no session for a conversation that captured nothing', () => {
    const db = database()

    recordAgentSessionEnd(db, { ...CONVERSATION, endedAt: '2026-10-31T09:30:00.000Z', reason: 'other' })
    recordAgentMessage(db, { ...CONVERSATION, kind: 'recap', text: 'nothing captured' })

    expect(endings(db)).toEqual([])
  })

  it('is no longer ended once the conversation is resumed', () => {
    const db = database()
    insertEventRecord(db, event({ agentSession: CONVERSATION }))
    recordAgentSessionEnd(db, { ...CONVERSATION, endedAt: '2026-10-31T09:30:00.000Z', reason: 'other' })

    insertEventRecord(db, event({ captured_at: '2026-10-31T11:00:00.000Z', agentSession: CONVERSATION }))

    expect(endings(db)).toEqual([expect.objectContaining({ ended_at: null, end_reason: null })])
  })

  it('stays ended for an event from before it ended that arrives late', () => {
    const db = database()
    insertEventRecord(db, event({ agentSession: CONVERSATION }))
    recordAgentSessionEnd(db, { ...CONVERSATION, endedAt: '2026-10-31T09:30:00.000Z', reason: 'other' })

    insertEventRecord(db, event({ captured_at: '2026-10-31T09:10:00.000Z', agentSession: CONVERSATION }))

    expect(endings(db)).toEqual([expect.objectContaining({ ended_at: '2026-10-31T09:30:00.000Z' })])
  })

  // An async tool hook fired before SessionEnd can still be stamped a moment after it
  it('stays ended for a tool event stamped just after the end', () => {
    const db = database()
    insertEventRecord(db, event({ agentSession: CONVERSATION }))
    recordAgentSessionEnd(db, { ...CONVERSATION, endedAt: '2026-10-31T09:30:00.000Z', reason: 'other' })

    insertEventRecord(db, event({ captured_at: '2026-10-31T09:30:02.000Z', agentSession: CONVERSATION }))

    expect(endings(db)).toEqual([
      expect.objectContaining({ ended_at: '2026-10-31T09:30:00.000Z', end_reason: 'other' }),
    ])
  })
})
