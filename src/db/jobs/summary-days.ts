import type { MigrationDatabase } from '../migration-types'
import type { BatchResult, DataJob, JobIssue, JobVerification } from './types'
import { dayOfSessionKey } from '../../summary/store'

// Gives each stored summary the day it describes (WOR-179), so it can still be found after the events it described are
// removed. The day is the one its key names (`project|<thread start>`); a summary whose key doesn't name one falls back
// to its first event's day. A row that has a day is never touched, so a rerun only visits what is left. Removal of old
// events waits for this job: a summary with no day is shown for no day once its events are gone.

const JOB_NAME = 'summary-days'

interface UndatedSummary {
  id: number
  source_key: string | null
  first_event_id: number | null
}

function readUndated(db: MigrationDatabase, afterId: number, limit: number): UndatedSummary[] {
  return db
    .prepare('SELECT id, source_key, first_event_id FROM summary WHERE id > ? AND day IS NULL ORDER BY id LIMIT ?')
    .all(afterId, limit) as unknown as UndatedSummary[]
}

function dayOfFirstEvent(db: MigrationDatabase, eventId: number | null): string | null {
  if (eventId === null) return null
  const row = db.prepare("SELECT date(captured_at, 'localtime') AS day FROM events WHERE id = ?").get(eventId) as
    | { day: string }
    | undefined
  return row?.day ?? null
}

function dayOf(db: MigrationDatabase, summary: UndatedSummary): string | null {
  const fromKey = summary.source_key === null ? null : dayOfSessionKey(summary.source_key)
  return fromKey ?? dayOfFirstEvent(db, summary.first_event_id)
}

function runBatch(db: MigrationDatabase, afterId: number, limit: number): BatchResult {
  const summaries = readUndated(db, afterId, limit)
  if (summaries.length === 0) return { lastId: null, issues: [] }
  const update = db.prepare('UPDATE summary SET day = ? WHERE id = ?')
  const issues: JobIssue[] = []
  for (const summary of summaries) {
    const day = dayOf(db, summary)
    if (day === null) {
      issues.push({
        reference: `summary ${summary.id}`,
        reason: 'no day could be read from its key or its first event',
      })
      continue
    }
    update.run(day, summary.id)
  }
  return { lastId: summaries[summaries.length - 1].id, issues }
}

/** A summary left without a day isn't lost data, only a summary no day will show: it is counted, not failed. */
function verify(db: MigrationDatabase): JobVerification {
  const counts = db.prepare('SELECT COUNT(*) AS checked, COUNT(day) AS resolved FROM summary').get() as unknown as {
    checked: number
    resolved: number
  }
  const unresolved = counts.checked - counts.resolved
  const notes = unresolved > 0 ? [`summaries with no day: ${unresolved}`] : []
  return { checked: counts.checked, resolved: counts.resolved, unresolved, hasPassed: true, notes }
}

export const summaryDaysJob: DataJob = {
  name: JOB_NAME,
  version: 1,
  description: 'Give each stored summary the day it describes',
  // Rows with a day are never visited again, so a rerun has nothing to clear first
  prepare: () => undefined,
  runBatch,
  verify,
}
