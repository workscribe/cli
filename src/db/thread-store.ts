import type { MigrationDatabase } from './migration-types'
import type { EventRow } from './types'
import type { DayBlocks } from '../sessions/blocks'
import { withReadTransaction } from './transaction'

// The stored work blocks, threads and slots (migration 009), and the stamp that says what a day was built from.
// `node:sqlite`-free: it takes the connection, so tests run it on an in-memory database.

/** What a day's blocks were built from. Any difference from the day as it is now means they're out of date. */
export interface DayStamp {
  groupingVersion: number
  idleMs: number
  eventCount: number
  /** `SUM(project_id × id)`: weighted by the event, so two events swapping projects still changes it */
  linkChecksum: number
  /**
   * `SUM(project_id² × id)`, each term reduced by a prime modulus so it can't overflow. Squaring isn't linear, so changes that cancel out in
   * `linkChecksum` (one event losing project 1 while another gains project 2) still change this one
   */
  linkSpread: number
  /** Null for a day with no events */
  maxEventId: number | null
}

/** What a day is grouped with: the rules' version and the idle timeout from the config. */
export type GroupingBasis = Pick<DayStamp, 'groupingVersion' | 'idleMs'>

/** A day's start and end as stored `captured_at` strings, end exclusive (`localDayBounds`). */
export interface DayRange {
  start: string
  end: string
}

export interface StoredThread {
  id: number
  blockId: number
  projectId: number | null
  startedAt: string
  endedAt: string
  eventCount: number
  activeSlots: number
}

export interface StoredBlock {
  id: number
  date: string
  startedAt: string
  endedAt: string
  eventCount: number
  activeSlots: number
  groupingVersion: number
  threads: StoredThread[]
}

const THREADS_OF_BLOCK_SQL = `SELECT id, block_id AS blockId, project_id AS projectId, started_at AS startedAt,
  ended_at AS endedAt, event_count AS eventCount, active_slots AS activeSlots
  FROM thread WHERE block_id = ? ORDER BY id`

const IN_DAY = 'captured_at >= $start AND captured_at < $end'
// A prime near 10⁹: each factor is reduced by it before multiplying, so no term or sum overflows 64-bit integers
const SPREAD_MODULUS = 1_000_000_007

/** The day's stamp as its events are now — one indexed range query. */
export function currentDayStamp(db: MigrationDatabase, range: DayRange, basis: GroupingBasis): DayStamp {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS eventCount, COALESCE(SUM(COALESCE(project_id, 0) * id), 0) AS linkChecksum,
              COALESCE(SUM(COALESCE(project_id, 0) * COALESCE(project_id, 0) % ${SPREAD_MODULUS}
                           * (id % ${SPREAD_MODULUS}) % ${SPREAD_MODULUS}), 0) AS linkSpread,
              MAX(id) AS maxEventId
       FROM events WHERE ${IN_DAY}`
    )
    .get(range) as Omit<DayStamp, keyof GroupingBasis>
  return { ...basis, ...row }
}

export function readDayStamp(db: MigrationDatabase, date: string): DayStamp | null {
  const row = db
    .prepare(
      `SELECT grouping_version AS groupingVersion, idle_ms AS idleMs, event_count AS eventCount,
              link_checksum AS linkChecksum, link_spread AS linkSpread, max_event_id AS maxEventId
       FROM grouping_day WHERE date = ?`
    )
    .get(date) as DayStamp | undefined
  return row ?? null
}

/** Compared field by field in JS, so an empty day's null `maxEventId` matches itself. */
export function isSameStamp(stored: DayStamp | null, current: DayStamp): boolean {
  return (
    stored !== null &&
    stored.groupingVersion === current.groupingVersion &&
    stored.idleMs === current.idleMs &&
    stored.eventCount === current.eventCount &&
    stored.linkChecksum === current.linkChecksum &&
    stored.linkSpread === current.linkSpread &&
    stored.maxEventId === current.maxEventId
  )
}

/** The day's events in grouping order — the same range the stamp counts, so the two always agree. */
export function getEventsInRange(db: MigrationDatabase, range: DayRange): EventRow[] {
  return db.prepare(`SELECT * FROM events WHERE ${IN_DAY} ORDER BY captured_at ASC, id ASC`).all(range) as EventRow[]
}

/** What `replaceDayBlocks` stores for a day: its blocks and slots, and the stamp they were built from. */
export interface DayBuild {
  date: string
  dayBlocks: DayBlocks
  stamp: DayStamp
}

function insertBlocks(db: MigrationDatabase, { date, dayBlocks, stamp }: DayBuild): void {
  const insertBlock = db.prepare(
    `INSERT INTO work_block (date, started_at, ended_at, event_count, active_slots, grouping_version)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
  )
  const insertThread = db.prepare(
    `INSERT INTO thread (block_id, project_id, started_at, ended_at, event_count, active_slots)
     VALUES (?, ?, ?, ?, ?, ?) RETURNING id`
  )
  const insertThreadEvent = db.prepare('INSERT INTO thread_event (thread_id, event_id) VALUES (?, ?)')
  for (const block of dayBlocks.blocks) {
    const { id: blockId } = insertBlock.get(
      date,
      block.startedAt,
      block.endedAt,
      block.eventCount,
      block.activeSlots,
      stamp.groupingVersion
    ) as { id: number }
    for (const thread of block.threads) {
      const { id: threadId } = insertThread.get(
        blockId,
        thread.projectId,
        thread.startedAt,
        thread.endedAt,
        thread.eventIds.length,
        thread.activeSlots
      ) as { id: number }
      for (const eventId of thread.eventIds) insertThreadEvent.run(threadId, eventId)
    }
  }
}

/** Replaces everything stored for the day — blocks (with their threads and links), slots and stamp. Call it in a transaction. */
export function replaceDayBlocks(db: MigrationDatabase, build: DayBuild): void {
  const { date, dayBlocks, stamp } = build
  db.prepare('DELETE FROM work_block WHERE date = ?').run(date)
  db.prepare('DELETE FROM activity_slot WHERE date = ?').run(date)
  insertBlocks(db, build)
  const insertSlot = db.prepare(
    'INSERT INTO activity_slot (date, slot_start, project_id, event_count) VALUES (?, ?, ?, ?)'
  )
  for (const slot of dayBlocks.slots) insertSlot.run(date, slot.slotStart, slot.projectId, slot.eventCount)
  db.prepare(
    `INSERT OR REPLACE INTO grouping_day
       (date, grouping_version, idle_ms, event_count, link_checksum, link_spread, max_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    date,
    stamp.groupingVersion,
    stamp.idleMs,
    stamp.eventCount,
    stamp.linkChecksum,
    stamp.linkSpread,
    stamp.maxEventId
  )
}

/** The day's blocks in time order, each with its threads in the order their projects first appear. */
export function getBlocksForDate(db: MigrationDatabase, date: string): StoredBlock[] {
  // One snapshot: a rebuild by another process between the two reads would otherwise leave blocks without threads
  return withReadTransaction(db, () => readBlocksForDate(db, date))
}

/** `getBlocksForDate` without a transaction of its own, for a caller already inside one. */
export function readBlocksForDate(db: MigrationDatabase, date: string): StoredBlock[] {
  const blocks = db
    .prepare(
      `SELECT id, date, started_at AS startedAt, ended_at AS endedAt, event_count AS eventCount,
              active_slots AS activeSlots, grouping_version AS groupingVersion
       FROM work_block WHERE date = ? ORDER BY started_at, id`
    )
    .all(date) as Omit<StoredBlock, 'threads'>[]
  const selectThreads = db.prepare(THREADS_OF_BLOCK_SQL)
  return blocks.map((block) => ({ ...block, threads: selectThreads.all(block.id) as StoredThread[] }))
}

export function getThreadEvents(db: MigrationDatabase, threadId: number): EventRow[] {
  return db
    .prepare(
      `SELECT events.* FROM events JOIN thread_event ON thread_event.event_id = events.id
       WHERE thread_event.thread_id = ? ORDER BY events.captured_at, events.id`
    )
    .all(threadId) as EventRow[]
}

/** A built block's threads, and every event of the block in grouping order with its thread. */
export interface BlockWithEvents {
  threads: StoredThread[]
  events: { id: number; threadId: number }[]
}

/**
 * The block holding an event — what `findSummaryThread` needs — read without a transaction of its own, for a caller
 * already inside one. Null when no built block holds the event (its day isn't built yet, or it was deleted).
 */
export function readBlockHoldingEvent(db: MigrationDatabase, eventId: number): BlockWithEvents | null {
  const holder = db
    .prepare(
      `SELECT thread.block_id AS blockId FROM thread_event JOIN thread ON thread.id = thread_event.thread_id
       WHERE thread_event.event_id = ?`
    )
    .get(eventId) as { blockId: number } | undefined
  if (holder === undefined) return null
  const threads = db.prepare(THREADS_OF_BLOCK_SQL).all(holder.blockId) as StoredThread[]
  const events = db
    .prepare(
      `SELECT events.id, thread_event.thread_id AS threadId FROM thread_event
       JOIN thread ON thread.id = thread_event.thread_id JOIN events ON events.id = thread_event.event_id
       WHERE thread.block_id = ? ORDER BY events.captured_at, events.id`
    )
    .all(holder.blockId) as BlockWithEvents['events']
  return { threads, events }
}

/** `readBlockHoldingEvent` in one snapshot of its own, so a rebuild by another process can't split the read. */
export function getBlockHoldingEvent(db: MigrationDatabase, eventId: number): BlockWithEvents | null {
  return withReadTransaction(db, () => readBlockHoldingEvent(db, eventId))
}
