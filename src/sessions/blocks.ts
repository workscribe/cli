import type { EventRow } from '../db/types'
import { LONG_RUNNING_THRESHOLD_MS, splitByIdleGap } from './grouper'

// A day's work as work blocks, project threads and activity slots (pure). A block is an idle-gap stretch of every
// event; a thread is one project's events inside it, whatever their order. Switching repos never starts, splits or
// names anything.

/** Bump when the rules below change: every day is then rebuilt the next time it's read. */
export const GROUPING_VERSION = 2

export const MS_PER_MINUTE = 60 * 1000
export const SLOT_MINUTES = 5
const SLOT_MS = SLOT_MINUTES * MS_PER_MINUTE

/** A local day as UTC milliseconds, end exclusive. */
export interface DayBounds {
  startMs: number
  endMs: number
}

/** A day's bounds, and the longest stretch of active time one event can claim. */
export interface SlotBounds extends DayBounds {
  maxSpanMs: number
}

export interface ThreadOfBlock {
  /** Null for the block's "elsewhere" thread: the events with no project */
  projectId: number | null
  startedAt: string
  endedAt: string
  eventIds: number[]
  activeSlots: number
}

export interface WorkBlock {
  startedAt: string
  endedAt: string
  eventCount: number
  activeSlots: number
  threads: ThreadOfBlock[]
}

export interface SlotCount {
  slotStart: string
  projectId: number | null
  eventCount: number
}

export interface DayBlocks {
  blocks: WorkBlock[]
  slots: SlotCount[]
}

export function floorToSlot(ms: number): number {
  return Math.floor(ms / SLOT_MS) * SLOT_MS
}

export function toActiveMinutes(activeSlots: number): number {
  return activeSlots * SLOT_MINUTES
}

function projectOf(event: EventRow): number | null {
  return event.project_id ?? null
}

/**
 * The slots an event occupies: the one its `captured_at` falls in, or for a long-running event every slot from its
 * start (captured time minus duration, as `splitByIdleGap` measures it) to its end. Clamped to the day.
 *
 * The duration counts for at most `maxSpanMs` (the idle timeout): a command's duration is its wall time, and an
 * interactive session left open for days (`claude`, `agy`) is stored once, at exit, with all of it. Activity inside
 * such a session arrives as events of its own, which fill their own slots.
 */
export function findSlotsOf(event: EventRow, bounds: SlotBounds): number[] {
  const endMs = Date.parse(event.captured_at)
  const durationMs = event.duration_ms ?? 0
  const startMs = durationMs >= LONG_RUNNING_THRESHOLD_MS ? endMs - Math.min(durationMs, bounds.maxSpanMs) : endMs
  const firstSlot = floorToSlot(Math.max(startMs, bounds.startMs))
  const lastSlot = floorToSlot(Math.min(endMs, bounds.endMs - 1))
  const slots: number[] = []
  for (let slot = firstSlot; slot <= lastSlot; slot += SLOT_MS) slots.push(slot)
  return slots
}

function countDistinctSlots(events: EventRow[], bounds: SlotBounds): number {
  return new Set(events.flatMap((event) => findSlotsOf(event, bounds))).size
}

/** One thread per project, in the order each project first appears, holding all of that project's events. */
function buildThreads(events: EventRow[], bounds: SlotBounds): ThreadOfBlock[] {
  const byProject = new Map<number | null, EventRow[]>()
  for (const event of events) {
    const projectEvents = byProject.get(projectOf(event))
    if (projectEvents) projectEvents.push(event)
    else byProject.set(projectOf(event), [event])
  }
  return [...byProject.entries()].map(([projectId, projectEvents]) => ({
    projectId,
    startedAt: projectEvents[0].captured_at,
    endedAt: projectEvents[projectEvents.length - 1].captured_at,
    eventIds: projectEvents.map((event) => event.id),
    activeSlots: countDistinctSlots(projectEvents, bounds),
  }))
}

function buildBlock(events: EventRow[], bounds: SlotBounds): WorkBlock {
  return {
    startedAt: events[0].captured_at,
    endedAt: events[events.length - 1].captured_at,
    eventCount: events.length,
    // Distinct slots across every project: time worked, never the sum of the threads' times
    activeSlots: countDistinctSlots(events, bounds),
    threads: buildThreads(events, bounds),
  }
}

/** How many of each project's events fall in each slot of the day. */
function countSlots(events: EventRow[], bounds: SlotBounds): SlotCount[] {
  const counts = new Map<string, SlotCount>()
  for (const event of events) {
    const projectId = projectOf(event)
    for (const slot of findSlotsOf(event, bounds)) {
      const key = `${slot}|${projectId ?? ''}`
      const count = counts.get(key) ?? { slotStart: new Date(slot).toISOString(), projectId, eventCount: 0 }
      counts.set(key, { ...count, eventCount: count.eventCount + 1 })
    }
  }
  return [...counts.values()].sort((first, second) => first.slotStart.localeCompare(second.slotStart))
}

/** The day's blocks, threads and slots, from its events in `captured_at, id` order. */
export function buildDayBlocks(events: EventRow[], idleMs: number, bounds: DayBounds): DayBlocks {
  const slotBounds: SlotBounds = { ...bounds, maxSpanMs: idleMs }
  const blocks = splitByIdleGap(events, idleMs)
    .filter((group) => group.length > 0)
    .map((group) => buildBlock(group, slotBounds))
  return { blocks, slots: countSlots(events, slotBounds) }
}
