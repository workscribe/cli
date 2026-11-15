import { isFailedExit } from '../../../summary/commits'
import { buildExcludedSet } from '../../../summary/exclusions'
import { describeAgents, editorSavesOf } from './agents'
import { describeChangedFiles } from './changes'
import { BUILD_WORDING, MAX_COMMIT_BULLETS, MAX_LISTED_PACKAGES, MAX_SESSION_BULLETS, TEST_WORDING } from './constants'
import { eventsOf, pluralize, stringsIn, unique } from './utils'
import type { EventPayload, SessionPayload } from '../../types'
import type { Outcome, OutcomeWording } from './types'

export function describeNotes(events: EventPayload[]): string[] {
  return eventsOf(events, 'note').flatMap((event) => stringsIn([event.metadata.text]).map((text) => `Note: ${text}`))
}

/** Commit messages from `git commit -m` and from AI sessions, in order, without repeats. A failed commit made none. */
export function collectCommits(events: EventPayload[]): string[] {
  return unique(
    events.flatMap((event) => {
      if (event.category === 'shipping' && !isFailedExit(event.exitCode)) return stringsIn([event.metadata.message])
      if (event.category === 'ai_session') return stringsIn(event.metadata.commits)
      return []
    })
  )
}

export function describeCommits(commits: string[]): string[] {
  const bullets = commits.slice(0, MAX_COMMIT_BULLETS).map((message) => `Committed: ${message}`)
  const hiddenCount = commits.length - MAX_COMMIT_BULLETS
  if (hiddenCount > 0) bullets[MAX_COMMIT_BULLETS - 1] += `, plus ${pluralize(hiddenCount, 'more change')}`
  return bullets
}

/**
 * How test or build runs turned out. A run with no known exit code never decides the outcome, so an earlier pass or
 * failure doesn't stand for it: when the latest run's code is unknown, the runs just ran. Null when there were none.
 */
export function outcomeOf(runs: EventPayload[]): Outcome | null {
  if (runs.length === 0) return null
  if (runs[runs.length - 1].exitCode === null) return 'ran'
  const knownExitCodes = runs.map((run) => run.exitCode).filter((exitCode): exitCode is number => exitCode !== null)
  if (knownExitCodes[knownExitCodes.length - 1] !== 0) return 'failing'
  if (knownExitCodes.some((exitCode) => exitCode !== 0)) return 'resolved'
  return 'passing'
}

/** Pass/fail line for test or build runs, with the run count — as the week digest words it. */
export function describeOutcome(events: EventPayload[], wording: OutcomeWording): string | null {
  const runs = eventsOf(events, wording.category)
  const outcome = outcomeOf(runs)
  if (outcome === null) return null
  const runCount = pluralize(runs.length, 'run')
  return outcome === 'resolved' ? `${wording.resolved} (${runCount}, now passing)` : `${wording[outcome]} (${runCount})`
}

function listPackages(packages: string[]): string {
  const listed = packages.slice(0, MAX_LISTED_PACKAGES).join(', ')
  const hiddenCount = packages.length - MAX_LISTED_PACKAGES
  return `${listed}${hiddenCount > 0 ? `, plus ${hiddenCount} more` : ''}`
}

interface DependencyOptions {
  /** Say how many installs ran when no package was named — the week digest does; the story doesn't */
  withRunCount?: boolean
}

/** Removals (`npm uninstall`, `yarn remove`, …) carry action: 'remove' and are worded separately from additions. */
export function describeDependencies(
  events: EventPayload[],
  { withRunCount = true }: DependencyOptions = {}
): string[] {
  const runs = eventsOf(events, 'dependencies')
  if (runs.length === 0) return []
  const isRemoval = (event: EventPayload): boolean => event.metadata.action === 'remove'
  const added = unique(runs.filter((event) => !isRemoval(event)).flatMap((event) => stringsIn(event.metadata.packages)))
  const removed = unique(runs.filter(isRemoval).flatMap((event) => stringsIn(event.metadata.packages)))
  if (added.length === 0 && removed.length === 0) {
    return [withRunCount ? `Installed dependencies (${pluralize(runs.length, 'run')})` : 'Installed dependencies']
  }

  return [
    ...(added.length > 0 ? [`Added dependencies: ${listPackages(added)}`] : []),
    ...(removed.length > 0 ? [`Removed dependencies: ${listPackages(removed)}`] : []),
  ]
}

export function describeReleases(events: EventPayload[]): string | null {
  const releases = eventsOf(events, 'releasing')
  if (releases.length === 0) return null
  const tools = unique(releases.flatMap((event) => stringsIn([event.metadata.tool])))
  return tools.length > 0 ? `Released / deployed (${tools.join(', ')})` : 'Released / deployed'
}

/** Where the session pushed. A push that failed (rejected, no upstream) pushed nothing. */
export function describePushes(events: EventPayload[]): string | null {
  const targets = unique(
    eventsOf(events, 'shipping').flatMap((event) => {
      const [remote] = stringsIn([event.metadata.remote])
      if (!remote || isFailedExit(event.exitCode)) return []
      const [branch] = stringsIn([event.metadata.branch])
      return [branch ? `${remote}/${branch}` : remote]
    })
  )
  return targets.length > 0 ? `Pushed to ${targets.join(', ')}` : null
}

/** The files changed, or — for edits stored before their file was kept — how many saves the editor made. */
function describeEdits(events: EventPayload[]): string | null {
  const saves = editorSavesOf(events).length
  return describeChangedFiles(events) ?? (saves > 0 ? `Edited files in the IDE (${pluralize(saves, 'save')})` : null)
}

/** The coding agents in the session — read from all its events, including ones the summary leaves out. */
function describeAgentWork(events: EventPayload[]): string | null {
  const agents = describeAgents(events)
  return agents === null ? null : `Worked with ${agents}`
}

/** Notes are always kept; everything else follows the same exclusions as the AI payload. */
export function includedEvents(events: EventPayload[], includeCategories: string[]): EventPayload[] {
  const excluded = buildExcludedSet(includeCategories)
  return events.filter((event) => event.category === 'note' || !excluded.has(event.category))
}

/**
 * The week digest's bullets for a location's day, most important first, capped at MAX_SESSION_BULLETS — empty if
 * nothing notable happened. A day's own summary tells the story instead (`story.ts`).
 */
export function describeActivity(session: SessionPayload, includeCategories: string[] = []): string[] {
  const events = includedEvents(session.events, includeCategories)
  return [
    ...describeNotes(events),
    ...describeCommits(collectCommits(events)),
    describeOutcome(events, TEST_WORDING),
    describeOutcome(events, BUILD_WORDING),
    ...describeDependencies(events),
    describeReleases(events),
    describePushes(events),
    describeAgentWork(session.events),
    describeEdits(events),
  ]
    .filter((bullet): bullet is string => bullet !== null)
    .slice(0, MAX_SESSION_BULLETS)
}

export function countIncludedEvents(session: SessionPayload, includeCategories: string[] = []): number {
  return includedEvents(session.events, includeCategories).length
}
