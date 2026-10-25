import { buildExcludedSet } from '../../prompt'
import { BUILD_WORDING, MAX_COMMIT_BULLETS, MAX_LISTED_PACKAGES, MAX_SESSION_BULLETS, TEST_WORDING } from './constants'
import { eventsOf, pluralize, stringsIn, unique } from './utils'
import type { EventPayload, SessionPayload } from '../../types'
import type { OutcomeWording } from './types'

function describeNotes(events: EventPayload[]): string[] {
  return eventsOf(events, 'note').flatMap((event) => stringsIn([event.metadata.text]).map((text) => `Note: ${text}`))
}

/** Commit messages from `git commit -m` and from AI sessions, in order, without repeats. */
export function collectCommits(events: EventPayload[]): string[] {
  return unique(
    events.flatMap((event) => {
      if (event.category === 'shipping') return stringsIn([event.metadata.message])
      if (event.category === 'ai_session') return stringsIn(event.metadata.commits)
      return []
    })
  )
}

function describeCommits(commits: string[]): string[] {
  const bullets = commits.slice(0, MAX_COMMIT_BULLETS).map((message) => `Committed: ${message}`)
  const hiddenCount = commits.length - MAX_COMMIT_BULLETS
  if (hiddenCount > 0) bullets[MAX_COMMIT_BULLETS - 1] += `, plus ${pluralize(hiddenCount, 'more change')}`
  return bullets
}

/**
 * Pass/fail story for test or build runs. Commands captured through AI-tool hooks have no exit
 * code, so they count towards the run total but never decide the outcome.
 */
export function describeOutcome(events: EventPayload[], wording: OutcomeWording): string | null {
  const runs = eventsOf(events, wording.category)
  if (runs.length === 0) return null

  const runCount = pluralize(runs.length, 'run')
  const knownExitCodes = runs.map((run) => run.exitCode).filter((exitCode): exitCode is number => exitCode !== null)
  if (knownExitCodes.length === 0) return `${wording.ran} (${runCount})`
  if (knownExitCodes[knownExitCodes.length - 1] !== 0) return `${wording.failing} (${runCount})`
  if (knownExitCodes.some((exitCode) => exitCode !== 0)) return `${wording.resolved} (${runCount}, now passing)`
  return `${wording.passing} (${runCount})`
}

function listPackages(packages: string[]): string {
  const listed = packages.slice(0, MAX_LISTED_PACKAGES).join(', ')
  const hiddenCount = packages.length - MAX_LISTED_PACKAGES
  return `${listed}${hiddenCount > 0 ? `, plus ${hiddenCount} more` : ''}`
}

/** Removals (`npm uninstall`, `yarn remove`, …) carry action: 'remove' and are worded separately from additions. */
function describeDependencies(events: EventPayload[]): string[] {
  const runs = eventsOf(events, 'dependencies')
  if (runs.length === 0) return []
  const isRemoval = (event: EventPayload): boolean => event.metadata.action === 'remove'
  const added = unique(runs.filter((event) => !isRemoval(event)).flatMap((event) => stringsIn(event.metadata.packages)))
  const removed = unique(runs.filter(isRemoval).flatMap((event) => stringsIn(event.metadata.packages)))
  if (added.length === 0 && removed.length === 0) return [`Installed dependencies (${pluralize(runs.length, 'run')})`]

  return [
    ...(added.length > 0 ? [`Added dependencies: ${listPackages(added)}`] : []),
    ...(removed.length > 0 ? [`Removed dependencies: ${listPackages(removed)}`] : []),
  ]
}

function describeReleases(events: EventPayload[]): string | null {
  const releases = eventsOf(events, 'releasing')
  if (releases.length === 0) return null
  const tools = unique(releases.flatMap((event) => stringsIn([event.metadata.tool])))
  return tools.length > 0 ? `Released / deployed (${tools.join(', ')})` : 'Released / deployed'
}

function describePushes(events: EventPayload[]): string | null {
  const targets = unique(
    eventsOf(events, 'shipping').flatMap((event) => {
      const [remote] = stringsIn([event.metadata.remote])
      if (!remote) return []
      const [branch] = stringsIn([event.metadata.branch])
      return [branch ? `${remote}/${branch}` : remote]
    })
  )
  return targets.length > 0 ? `Pushed to ${targets.join(', ')}` : null
}

function describeEdits(events: EventPayload[]): string | null {
  const saves = eventsOf(events, 'code_edit').length
  return saves > 0 ? `Edited files in the IDE (${pluralize(saves, 'save')})` : null
}

/** Notes are always kept; everything else follows the same exclusions as the AI payload. */
function includedEvents(events: EventPayload[], includeCategories: string[]): EventPayload[] {
  const excluded = buildExcludedSet(includeCategories)
  return events.filter((event) => event.category === 'note' || !excluded.has(event.category))
}

/** Outcome bullets for one session, most important first, capped at MAX_SESSION_BULLETS. Empty if nothing notable happened. */
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
    describeEdits(events),
  ]
    .filter((bullet): bullet is string => bullet !== null)
    .slice(0, MAX_SESSION_BULLETS)
}

export function countIncludedEvents(session: SessionPayload, includeCategories: string[] = []): number {
  return includedEvents(session.events, includeCategories).length
}

/** Outcome bullets for one session, or a line saying where the work happened when nothing stands out. */
export function describeSession(session: SessionPayload, includeCategories: string[] = []): string[] {
  const bullets = describeActivity(session, includeCategories)
  if (bullets.length > 0) return bullets
  const commandCount = pluralize(countIncludedEvents(session, includeCategories), 'command')
  return [`Worked in ${session.project ?? 'an unknown location'} (${commandCount})`]
}
