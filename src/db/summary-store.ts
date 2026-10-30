import type { MigrationDatabase } from './migration-types'
import { withImmediateTransaction } from './transaction'
import type { StoredEngine } from '../ai/engine'
import type { AnchorRange } from '../summary/anchors'

// The `summary` table (migration 010): summaries anchored to the events they describe. Until every reader is on it,
// `sessions summary set` writes here and to `session_summaries`, and the `summary-anchors` job maps the old store.
// `node:sqlite`-free, so tests run it on an in-memory database.

/** `saved`: written by `sessions summary set`, from the live session. `mapped`: rebuilt by the job from the old store. */
export type SummaryOrigin = 'saved' | 'mapped'
export const SAVED_ORIGIN: SummaryOrigin = 'saved'
export const MAPPED_ORIGIN: SummaryOrigin = 'mapped'

/**
 * Where a summary's range came from: the live session it was saved from, the cached old session, the old session
 * regrouped from its day, or nowhere (kept without a range).
 */
export type AnchorSource = 'live' | 'cached' | 'regrouped' | 'none'

export interface SummaryRow {
  id: number
  scope: string
  project_id: number | null
  first_event_id: number | null
  last_event_id: number | null
  engine: StoredEngine
  text: string
  created_at: string
  source_key: string | null
  origin: SummaryOrigin
  anchor_source: AnchorSource
  /** 1 when its session mixed projects, so it matches no thread */
  is_mixed: number
}

/** A summary of an old session, by the key it was saved under. */
export interface SessionSummaryRecord {
  sourceKey: string
  engine: StoredEngine
  text: string
  createdAt: string
  anchor: AnchorRange & { isMixed: boolean }
  anchorSource: AnchorSource
}

const SESSION_SCOPE = 'session'

const INSERT_SUMMARY = `INSERT INTO summary
    (scope, project_id, first_event_id, last_event_id, engine, text, created_at, source_key, origin, anchor_source, is_mixed)
  VALUES ('${SESSION_SCOPE}', $project_id, $first_event_id, $last_event_id, $engine, $text, $created_at, $source_key,
    $origin, $anchor_source, $is_mixed)
  ON CONFLICT (source_key, engine) DO UPDATE SET
    project_id = excluded.project_id, first_event_id = excluded.first_event_id, last_event_id = excluded.last_event_id,
    text = excluded.text, created_at = excluded.created_at, origin = excluded.origin,
    anchor_source = excluded.anchor_source, is_mixed = excluded.is_mixed`

/** A saved summary replaces whatever row its key and engine had. */
const SAVE_SUMMARY = INSERT_SUMMARY
/** A mapped summary replaces only a row the job wrote itself, never one `sessions summary set` saved. */
const MAP_SUMMARY = `${INSERT_SUMMARY} WHERE summary.origin = '${MAPPED_ORIGIN}'`

function parametersOf(record: SessionSummaryRecord, origin: SummaryOrigin): Record<string, unknown> {
  return {
    project_id: record.anchor.projectId,
    first_event_id: record.anchor.firstEventId,
    last_event_id: record.anchor.lastEventId,
    engine: record.engine,
    text: record.text,
    created_at: record.createdAt,
    source_key: record.sourceKey,
    origin,
    anchor_source: record.anchorSource,
    is_mixed: record.anchor.isMixed ? 1 : 0,
  }
}

/**
 * Saves a summary the agent skill wrote to both stores in one transaction: `session_summaries` exactly as before,
 * and `summary`, anchored from the live session — overwriting a row the job mapped for the same key and engine.
 */
export function saveSummaryToBothStores(db: MigrationDatabase, record: SessionSummaryRecord): void {
  withImmediateTransaction(db, () => {
    db.prepare(
      `INSERT INTO session_summaries (session_key, engine, text, created_at)
       VALUES ($session_key, $engine, $text, $created_at)
       ON CONFLICT (session_key, engine) DO UPDATE SET text = excluded.text, created_at = excluded.created_at`
    ).run({ session_key: record.sourceKey, engine: record.engine, text: record.text, created_at: record.createdAt })
    db.prepare(SAVE_SUMMARY).run(parametersOf(record, SAVED_ORIGIN))
  })
}

/**
 * The job's write: inserts or rebuilds a mapped row. A row `sessions summary set` saved keeps its range and text —
 * the live session it came from beats anything rebuilt — and only gets its project when it had none.
 */
export function mapSummary(db: MigrationDatabase, record: SessionSummaryRecord): void {
  db.prepare(MAP_SUMMARY).run(parametersOf(record, MAPPED_ORIGIN))
  if (record.anchor.projectId === null) return
  db.prepare(
    `UPDATE summary SET project_id = ?
     WHERE source_key = ? AND engine = ? AND origin = '${SAVED_ORIGIN}' AND project_id IS NULL`
  ).run(record.anchor.projectId, record.sourceKey, record.engine)
}

export function getSummaryBySource(db: MigrationDatabase, sourceKey: string, engine: string): SummaryRow | null {
  const row = db.prepare('SELECT * FROM summary WHERE source_key = ? AND engine = ?').get(sourceKey, engine) as
    | SummaryRow
    | undefined
  return row ?? null
}
