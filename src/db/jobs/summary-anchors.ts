import type { MigrationDatabase } from '../migration-types'
import type { EventRow } from '../types'
import { SESSION_KEY_SQL } from '../migrations/005_session_summaries'
import { MAPPED_ORIGIN, mapSummary, type AnchorSource } from '../summary-store'
import { anchorOfKeyedSession, type SummaryAnchor } from '../../summary/anchors'
import { parseSessionKey, sessionKey } from '../../summary/store'
import { localDateOf } from '../../utils/format'
import { groupOldSessions, type OldSession } from './frozen-old-sessions'
import type { StoredEngine } from '../../ai/engine'
import type { BatchResult, DataJob, JobIssue, JobVerification } from './types'

// Maps every summary in `session_summaries` onto the events it describes (the `summary` table, migration 010), so it
// survives regrouping. Nothing is deleted: a summary whose session can't be found is kept without a range, and
// every doubtful match is recorded.

interface OldSummaryRow {
  id: number
  session_key: string
  engine: StoredEngine
  text: string
  created_at: string
}

/** A batch's regrouped days, so a day several summaries share is read and regrouped once. */
type RegroupedDays = Map<string, OldSession[]>

/** The cached old session under the key — looked up within its day, so `idx_sessions_date` narrows the search. */
function eventsOfCachedSession(db: MigrationDatabase, key: string, date: string): EventRow[] | null {
  const session = db
    .prepare(`SELECT id FROM sessions WHERE date = ? AND ${SESSION_KEY_SQL} = ? ORDER BY id LIMIT 1`)
    .get(date, key) as { id: number } | undefined
  if (session === undefined) return null
  return db
    .prepare(
      `SELECT events.* FROM events JOIN session_events ON session_events.event_id = events.id
       WHERE session_events.session_id = ? ORDER BY events.captured_at, events.id`
    )
    .all(session.id) as EventRow[]
}

function regroupDay(db: MigrationDatabase, date: string, days: RegroupedDays): OldSession[] {
  const known = days.get(date)
  if (known !== undefined) return known
  const dayEvents = db
    .prepare(`SELECT * FROM events WHERE date(captured_at, 'localtime') = ? ORDER BY captured_at, id`)
    .all(date) as EventRow[]
  const sessions = groupOldSessions(dayEvents)
  days.set(date, sessions)
  return sessions
}

function findSessionEvents(
  db: MigrationDatabase,
  key: string,
  days: RegroupedDays
): { source: AnchorSource; events: EventRow[] } {
  const parsed = parseSessionKey(key)
  if (parsed === null) return { source: 'none', events: [] }
  const date = localDateOf(parsed.startedAt)
  const cached = eventsOfCachedSession(db, key, date)
  if (cached !== null && cached.length > 0) return { source: 'cached', events: cached }
  // No longer cached: the old session regrouped from its day with the frozen rules
  const match = regroupDay(db, date, days).find((session) => sessionKey(session.repoName, session.startedAt) === key)
  if (match !== undefined) return { source: 'regrouped', events: match.events }
  return { source: 'none', events: [] }
}

function issuesOf(row: OldSummaryRow, source: AnchorSource, anchor: SummaryAnchor): JobIssue[] {
  const reference = `${row.session_key} (${row.engine})`
  const issues: JobIssue[] = []
  if (source === 'none') {
    issues.push({ reference, reason: 'no events match this session any more; the summary is kept without a range' })
  }
  if (source === 'regrouped') {
    issues.push({
      reference,
      reason:
        'the session was no longer cached; its range comes from regrouping its day with the default 30-minute idle timeout',
    })
  }
  if (anchor.isUnlinked) {
    issues.push({ reference, reason: "the session's events aren't linked to a project yet" })
  }
  if (anchor.isMixed) {
    const percent = Math.round(anchor.share * 100)
    issues.push({
      reference,
      reason: `the session mixed projects: its own project held ${percent}% of its events, so the summary matches no thread`,
    })
  }
  return issues
}

function mapRow(db: MigrationDatabase, row: OldSummaryRow, days: RegroupedDays): JobIssue[] {
  const { source, events } = findSessionEvents(db, row.session_key, days)
  const anchor = anchorOfKeyedSession(events, row.session_key)
  mapSummary(db, {
    sourceKey: row.session_key,
    engine: row.engine,
    text: row.text,
    createdAt: row.created_at,
    anchor,
    anchorSource: source,
  })
  return issuesOf(row, source, anchor)
}

function runBatch(db: MigrationDatabase, afterId: number, limit: number): BatchResult {
  const rows = db
    .prepare(
      `SELECT rowid AS id, session_key, engine, text, created_at FROM session_summaries
       WHERE rowid > ? ORDER BY rowid LIMIT ?`
    )
    .all(afterId, limit) as OldSummaryRow[]
  const regroupedDays: RegroupedDays = new Map()
  return {
    lastId: rows.length === 0 ? null : rows[rows.length - 1].id,
    issues: rows.flatMap((row) => mapRow(db, row, regroupedDays)),
  }
}

function countRows(db: MigrationDatabase, sql: string): number {
  return (db.prepare(sql).get() as { count: number }).count
}

const SOURCE_LABELS: Record<AnchorSource, string> = {
  thread: 'saved for a thread by the agent skill',
  live: 'from the live session, saved by the agent skill since this upgrade',
  cached: "from the old session's cached events",
  regrouped: "from the old session's day, regrouped",
  none: 'kept without a range (their events are gone)',
}

/** How many of the old store's summaries came from each source, and how many mixed projects. */
function sourceNotes(db: MigrationDatabase): string[] {
  const rows = db
    .prepare(
      `SELECT summary.anchor_source AS source, COUNT(*) AS count, SUM(summary.is_mixed) AS mixed
       FROM session_summaries old
       JOIN summary ON summary.source_key = old.session_key AND summary.engine = old.engine
       GROUP BY summary.anchor_source ORDER BY count DESC`
    )
    .all() as { source: AnchorSource; count: number; mixed: number }[]
  const notes = rows.map((row) => `${row.count} ${SOURCE_LABELS[row.source]}`)
  const mixed = rows.reduce((total, row) => total + row.mixed, 0)
  if (mixed > 0) notes.push(`${mixed} described a session that mixed projects, so they match no thread`)
  return notes
}

/** Passes when every old summary has a row in `summary`: none was lost, whether or not it found its events. */
function verify(db: MigrationDatabase): JobVerification {
  const checked = countRows(db, 'SELECT COUNT(*) AS count FROM session_summaries')
  const joined = `FROM session_summaries old
    LEFT JOIN summary ON summary.source_key = old.session_key AND summary.engine = old.engine`
  const missing = countRows(db, `SELECT COUNT(*) AS count ${joined} WHERE summary.id IS NULL`)
  const unanchored = countRows(
    db,
    `SELECT COUNT(*) AS count ${joined} WHERE summary.id IS NOT NULL AND summary.first_event_id IS NULL`
  )
  const notes = sourceNotes(db)
  if (missing > 0) notes.push(`${missing} summaries have no anchored copy`)
  return { checked, resolved: checked - missing - unanchored, unresolved: unanchored, hasPassed: missing === 0, notes }
}

export const summaryAnchorsJob: DataJob = {
  name: 'summary-anchors',
  version: 1,
  description: 'Anchor saved summaries to the events they describe',
  // Only rows the job wrote and can write again; a summary `sessions summary set` saved is never deleted
  prepare: (db) =>
    db.exec(`DELETE FROM summary WHERE origin = '${MAPPED_ORIGIN}' AND EXISTS (
      SELECT 1 FROM session_summaries old WHERE old.session_key = summary.source_key AND old.engine = summary.engine
    )`),
  runBatch,
  verify,
}
