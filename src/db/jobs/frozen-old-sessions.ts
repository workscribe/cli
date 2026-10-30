import type { EventRow } from '../types'

// A frozen copy of how 1.x and 2.0 grouped a day into sessions (src/sessions/grouper.ts and detector.ts at the time
// of this job), so the summary-anchors job can find an old session's events after the live grouper is gone. Never
// change it: a summary's key was made by exactly these rules. Pure.

const IDLE_MS = 30 * 60 * 1000 // the default `session.idleTimeout`: jobs never read the config
const LONG_RUNNING_MS = 5 * 60 * 1000
const REPO_SWITCH_GAP_MS = 10 * 60 * 1000

function splitByIdleGap(events: EventRow[]): EventRow[][] {
  const groups: EventRow[][] = []
  for (const [index, event] of events.entries()) {
    const completedMs = Date.parse(event.captured_at)
    const durationMs = event.duration_ms ?? 0
    const effectiveMs = durationMs >= LONG_RUNNING_MS ? completedMs - durationMs : completedMs
    const isAfterGap = index > 0 && effectiveMs - Date.parse(events[index - 1].captured_at) >= IDLE_MS
    if (index === 0 || isAfterGap) groups.push([event])
    else groups[groups.length - 1].push(event)
  }
  return groups
}

function splitByRepo(events: EventRow[]): EventRow[][] {
  const groups: EventRow[][] = []
  for (const [index, event] of events.entries()) {
    const previous = events[index - 1]
    const isRepoSwitch =
      index > 0 &&
      event.repo_name !== previous.repo_name &&
      Date.parse(event.captured_at) - Date.parse(previous.captured_at) >= REPO_SWITCH_GAP_MS
    if (index === 0 || isRepoSwitch) groups.push([event])
    else groups[groups.length - 1].push(event)
  }
  return groups
}

export interface OldSession {
  /** The repo the session was named after: its last event's, else its first's */
  repoName: string | null
  startedAt: string
  events: EventRow[]
}

/** A day's sessions as the old grouper made them, from its events in `captured_at, id` order. */
export function groupOldSessions(dayEvents: EventRow[]): OldSession[] {
  return splitByIdleGap(dayEvents)
    .flatMap(splitByRepo)
    .map((events) => ({
      repoName: events[events.length - 1].repo_name ?? events[0].repo_name ?? null,
      startedAt: events[0].captured_at,
      events,
    }))
}
