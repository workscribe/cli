import type { MigrationDatabase } from '../migration-types'
import type { BatchResult, DataJob, JobVerification } from './types'
import { BUSY_TIMEOUT_MS } from '../transaction'
import { deleteMetaValue, getMetaValue, setMetaValue } from './store'
import { commandHint } from '../../capture/hint'
import { storableAgentMessage } from '../../capture/agent-messages'
import { REDACTED_TEXT, redact } from '../../capture/redact'
import { debugLog } from '../../utils/logger'

// Applies today's built-in redaction to what was stored before it existed (WOR-167), and to agent recaps (WOR-137). A
// job can't read the config, so `redact.extra` only ever reaches new events. Rows with nothing to redact are never
// written. Bump the version when the built-in patterns widen, so the history gets the new ones too.

const JOB_NAME = 'scrub-secrets'
const VERIFY_PAGE_SIZE = 500
const CLEANUP_KEY = 'scrub-secrets:file-cleanup'
const CLEANUP_NEEDS_VACUUM = 'vacuum'
const CLEANUP_NEEDS_CHECKPOINT = 'checkpoint'
// An ordinary command runs the cleanup, and it must not stall behind a capture or a reader: the next one tries again
const CLEANUP_LOCK_WAIT_MS = 200

interface StoredText {
  command: string
  metadata: string | null
}

type StoredEvent = StoredText & { id: number }

interface CommandChange {
  before: string
  after: string
}

/**
 * Most values were read from the command, which redaction judged with all of its context. So one still in the scrubbed
 * command stays (`fix mongo -p flag`, inside `-m "..."`). Otherwise redaction may recognise the secret in the value itself,
 * which keeps the rest of it (`add --pass [REDACTED]`). If not, a value only the old command held was removed from it,
 * even though it says nothing alone: the `FAKE` of `npm install --token FAKE lodash`.
 */
function scrubValue(value: string, command: CommandChange): string {
  if (command.after.includes(value)) return value
  const redacted = redact(value)
  if (redacted !== value) return redacted
  return command.before.includes(value) ? REDACTED_TEXT : value
}

function scrubStrings(value: unknown, command: CommandChange): unknown {
  if (typeof value === 'string') return scrubValue(value, command)
  if (Array.isArray(value)) return value.map((item) => scrubStrings(item, command))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrubStrings(item, command)]))
}

function hasHint(value: unknown): value is { hint: string } {
  return typeof (value as { hint?: unknown } | null)?.hint === 'string'
}

function scrubMetadata(metadata: string | null, command: CommandChange): string | null {
  if (metadata === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(metadata)
  } catch {
    // Unreadable, so nothing else can use it either: it still mustn't keep a secret
    return redact(metadata)
  }
  const scrubbed = scrubStrings(parsed, command)
  // A stored hint can end midway through a secret, too short for a pattern to recognise, so it's taken again
  if (command.after !== command.before && hasHint(scrubbed)) scrubbed.hint = commandHint(command.after)
  const rewritten = JSON.stringify(scrubbed)
  return rewritten === JSON.stringify(parsed) ? metadata : rewritten
}

/** The event's text with its secrets removed, or null when there's nothing to remove. */
export function scrubEvent({ command, metadata }: StoredText): StoredText | null {
  const scrubbedCommand = redact(command)
  const scrubbedMetadata = scrubMetadata(metadata, { before: command, after: scrubbedCommand })
  if (scrubbedCommand === command && scrubbedMetadata === metadata) return null
  return { command: scrubbedCommand, metadata: scrubbedMetadata }
}

/** Which of the optional `events` columns a database has: a backup from an older version may lack some. */
export interface EventColumns {
  hasMetadata: boolean
  hasFilePath: boolean
}

const CURRENT_EVENT_COLUMNS: EventColumns = { hasMetadata: true, hasFilePath: true }

/**
 * An IDE save's command is its file's path, and its metadata is only line counts — no text to scrub. An event with its
 * own command is still checked.
 */
function readEvents(
  db: MigrationDatabase,
  afterId: number,
  limit: number,
  { hasMetadata, hasFilePath }: EventColumns = CURRENT_EVENT_COLUMNS
): StoredEvent[] {
  return db
    .prepare(
      `SELECT id, command, ${hasMetadata ? 'metadata' : 'NULL AS metadata'} FROM events
       WHERE id > ? ${hasFilePath ? 'AND command IS NOT file_path' : ''}
       ORDER BY id LIMIT ?`
    )
    .all(afterId, limit) as StoredEvent[]
}

/**
 * Scrubs up to `limit` events after `afterId`, rewriting only the ones that change. Returns the last id it read (null
 * when there were none) and how many it rewrote. The job runs it on the live database; the backup scrub on each copy.
 */
export function scrubEventBatch(
  db: MigrationDatabase,
  afterId: number,
  limit: number,
  columns: EventColumns = CURRENT_EVENT_COLUMNS
): { lastId: number | null; changed: number } {
  const events = readEvents(db, afterId, limit, columns)
  if (events.length === 0) return { lastId: null, changed: 0 }
  const update = db.prepare(
    columns.hasMetadata
      ? 'UPDATE events SET command = ?, metadata = ? WHERE id = ?'
      : 'UPDATE events SET command = ? WHERE id = ?'
  )
  let changed = 0
  for (const event of events) {
    const scrubbed = scrubEvent(event)
    if (scrubbed === null) continue
    if (columns.hasMetadata) update.run(scrubbed.command, scrubbed.metadata, event.id)
    else update.run(scrubbed.command, event.id)
    changed++
  }
  return { lastId: events[events.length - 1].id, changed }
}

function runBatch(db: MigrationDatabase, afterId: number, limit: number): BatchResult {
  return { lastId: scrubEventBatch(db, afterId, limit).lastId, issues: [] }
}

/** Nothing is ever removed, and a rerun couldn't clear a row that redacts differently twice: the count is for `status`. */
function verify(db: MigrationDatabase): JobVerification {
  let checked = 0
  let unresolved = 0
  let afterId = 0
  for (;;) {
    const events = readEvents(db, afterId, VERIFY_PAGE_SIZE)
    if (events.length === 0) break
    checked += events.length
    unresolved += events.filter((event) => scrubEvent(event) !== null).length
    afterId = events[events.length - 1].id
  }
  const notes = unresolved > 0 ? [`events that would still change: ${unresolved}`] : []
  return { checked, resolved: checked - unresolved, unresolved, hasPassed: true, notes }
}

/**
 * An update leaves the old text in the file's free space, and a page's unused space can hold copies from long before,
 * which even `secure_delete` doesn't reach. Only `VACUUM` rewrites the file without them, and the checkpoint then moves
 * the result out of the WAL. Each step is recorded, so a busy reader or a crash means carrying on from it next time.
 */
function cleanUpFile(db: MigrationDatabase): void {
  db.exec(`PRAGMA busy_timeout = ${CLEANUP_LOCK_WAIT_MS}`)
  try {
    if (getMetaValue(db, CLEANUP_KEY) === CLEANUP_NEEDS_VACUUM) {
      db.exec('VACUUM')
      setMetaValue(db, CLEANUP_KEY, CLEANUP_NEEDS_CHECKPOINT)
    }
    const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number } | undefined
    if (result?.busy) {
      debugLog(`data job ${JOB_NAME}: file cleanup`, 'left for later, a reader is busy')
      return
    }
    deleteMetaValue(db, CLEANUP_KEY)
  } finally {
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
  }
}

/**
 * A stored recap or compaction summary as it would be stored today: redacted, and gone when the secret check flags it.
 * The same rule that stops a flagged message on the way in, applied to what was stored before it widened.
 */
function scrubAgentMessage(message: string): string | null {
  return storableAgentMessage(message, [])
}

/** The agent sessions are few, so their messages are scrubbed in one pass before the events. Returns how many changed. */
export function scrubAgentMessages(db: MigrationDatabase): number {
  const sessions = db.prepare('SELECT id, recap, compact_summary AS compactSummary FROM agent_sessions').all() as {
    id: number
    recap: string | null
    compactSummary: string | null
  }[]
  const update = db.prepare('UPDATE agent_sessions SET recap = ?, compact_summary = ? WHERE id = ?')
  const scrubbed = (message: string | null) => (message === null ? null : scrubAgentMessage(message))
  let changed = 0
  for (const session of sessions) {
    const recap = scrubbed(session.recap)
    const compactSummary = scrubbed(session.compactSummary)
    if (recap === session.recap && compactSummary === session.compactSummary) continue
    update.run(recap, compactSummary, session.id)
    changed++
  }
  return changed
}

export const scrubSecretsJob: DataJob = {
  name: JOB_NAME,
  version: 5,
  description: 'Remove secrets from stored commands, metadata and agent recaps',
  // Redacting what's already redacted changes nothing, so a rerun only needs the file cleaned again
  prepare: (db) => {
    scrubAgentMessages(db)
    setMetaValue(db, CLEANUP_KEY, CLEANUP_NEEDS_VACUUM)
  },
  runBatch,
  verify,
  cleanup: { isPending: (db) => getMetaValue(db, CLEANUP_KEY) !== null, run: cleanUpFile },
}
