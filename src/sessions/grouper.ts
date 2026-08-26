import type { EventRow } from '../db/types'

// captured_at is set at command completion (precmd fires after the command exits).
// A long-running command's captured_at is its end time, so the gap between it and
// the prior event equals the command's full duration — falsely triggering the idle
// threshold. We use its start time (completion − duration) for gap calculation instead.
export const LONG_RUNNING_THRESHOLD_MS = 5 * 60 * 1000 // 5 minutes

/**
 * Split a sorted list of events into groups separated by idle gaps.
 */
export function splitByIdleGap(events: EventRow[], idleMs: number): EventRow[][] {
  if (events.length === 0) return []
  const groups: EventRow[][] = [[events[0]]]

  for (let i = 1; i < events.length; i++) {
    const prev = new Date(events[i - 1].captured_at).getTime()
    const currCompleted = new Date(events[i].captured_at).getTime()
    const currDuration = events[i].duration_ms ?? 0
    const currEffective = currDuration >= LONG_RUNNING_THRESHOLD_MS ? currCompleted - currDuration : currCompleted

    if (currEffective - prev >= idleMs) {
      groups.push([events[i]])
    } else {
      groups[groups.length - 1].push(events[i])
    }
  }

  return groups
}

/**
 * Split a list of events into groups by consecutive repo_name.
 * A repo change mid-stream creates a new group.
 */
export function splitByRepo(events: EventRow[]): EventRow[][] {
  if (events.length === 0) return []
  const groups: EventRow[][] = [[events[0]]]

  for (let i = 1; i < events.length; i++) {
    const prevRepo = events[i - 1].repo_name
    const currRepo = events[i].repo_name
    if (currRepo !== prevRepo) {
      groups.push([events[i]])
    } else {
      groups[groups.length - 1].push(events[i])
    }
  }

  return groups
}

export function minutesBetween(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 60000
}
