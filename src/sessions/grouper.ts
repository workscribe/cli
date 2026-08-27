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

// A repo switch only starts a new sub-session if the gap since the last event
// exceeds this threshold. A quick check in another repo and back should not
// fragment the session.
export const REPO_SWITCH_GAP_MS = 10 * 60 * 1000 // 10 minutes

/**
 * Split a list of events into groups by consecutive repo_name.
 * A repo change only creates a new group if the gap since the previous
 * event is at least `gapMs` (default 0 — splits on every repo change,
 * matching pre-WOR-72 behavior for callers that don't pass a threshold).
 */
export function splitByRepo(events: EventRow[], gapMs = 0): EventRow[][] {
  if (events.length === 0) return []
  const groups: EventRow[][] = [[events[0]]]

  for (let i = 1; i < events.length; i++) {
    const prevRepo = events[i - 1].repo_name
    const currRepo = events[i].repo_name
    const prevTime = new Date(events[i - 1].captured_at).getTime()
    const currTime = new Date(events[i].captured_at).getTime()
    const gap = currTime - prevTime

    if (currRepo !== prevRepo && gap >= gapMs) {
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
