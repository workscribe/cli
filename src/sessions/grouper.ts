import type { EventRow } from '../db/types'

/**
 * Split a sorted list of events into groups separated by idle gaps.
 */
export function splitByIdleGap(events: EventRow[], idleMs: number): EventRow[][] {
  if (events.length === 0) return []
  const groups: EventRow[][] = [[events[0]]]

  for (let i = 1; i < events.length; i++) {
    const prev = new Date(events[i - 1].captured_at).getTime()
    const curr = new Date(events[i].captured_at).getTime()
    if (curr - prev >= idleMs) {
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
