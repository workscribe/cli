import { getDb } from '../db'
import { withImmediateTransaction, type TransactionOptions } from '../db/transaction'
import {
  currentDayStamp,
  getBlocksForDate,
  getEventsInRange,
  isSameStamp,
  readDayStamp,
  replaceDayBlocks,
  type DayRange,
  type GroupingBasis,
  type StoredBlock,
} from '../db/thread-store'
import { readConfig } from '../config'
import { localDayBounds } from '../utils/format'
import { buildDayBlocks, GROUPING_VERSION, MS_PER_MINUTE } from './blocks'

// Builds a day's work blocks, threads and slots, under the write lock and rechecked first, so two processes never
// build the same day twice. Every reader of a day's work — `sessions`, `summary`, `export`, the week and `context` —
// reads them.

export interface ThreadGroupingOptions {
  /** Wait at most this long for another process's write lock (default: the connection's 5 s). */
  lockWaitMs?: number
}

function groupingBasis(): GroupingBasis {
  return { groupingVersion: GROUPING_VERSION, idleMs: readConfig().session.idleTimeout * MS_PER_MINUTE }
}

function isDayUpToDate(date: string, range: DayRange, basis: GroupingBasis): boolean {
  const db = getDb()
  return isSameStamp(readDayStamp(db, date), currentDayStamp(db, range, basis))
}

/** Reads the day's events and replaces its blocks, threads, slots and stamp. Runs inside the write lock. */
function rebuildDay(date: string, range: DayRange, basis: GroupingBasis): void {
  const db = getDb()
  const stamp = currentDayStamp(db, range, basis)
  const bounds = { startMs: Date.parse(range.start), endMs: Date.parse(range.end) }
  const dayBlocks = buildDayBlocks(getEventsInRange(db, range), basis.idleMs, bounds)
  replaceDayBlocks(db, { date, dayBlocks, stamp })
}

/**
 * Builds the day's blocks and threads unless they're up to date with its events, their project links, the idle
 * timeout and `GROUPING_VERSION`. The rebuild holds the write lock and rechecks first, so two processes never build
 * the same day twice. Throws a locked error (`isDatabaseLocked`) if another process keeps the lock past `lockWaitMs`.
 */
export function ensureDayThreads(date: string, options: ThreadGroupingOptions = {}): void {
  const range = localDayBounds(date)
  const basis = groupingBasis()
  if (isDayUpToDate(date, range, basis)) return
  const transactionOptions: TransactionOptions = { busyTimeoutMs: options.lockWaitMs }
  withImmediateTransaction(
    getDb(),
    () => {
      // Another process may have built the day while this one waited for the lock
      if (isDayUpToDate(date, range, basis)) return
      rebuildDay(date, range, basis)
    },
    transactionOptions
  )
}

export function getOrBuildBlocks(date: string, options: ThreadGroupingOptions = {}): StoredBlock[] {
  ensureDayThreads(date, options)
  return getBlocksForDate(getDb(), date)
}
