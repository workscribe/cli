// A day's session as a story: notes first, then what was done on each branch — commits, then outcomes, then what
// shipped — and the agent and editor activity in one closing line. Pure: it only reads the payload.
import { formatSessionHeading } from '../../../summary/heading'
import {
  AGENT_SOURCES,
  MAX_SESSION_BULLETS,
  MAX_STORY_BRANCHES,
  STORY_BUILD_WORDING,
  STORY_TEST_WORDING,
} from './constants'
import {
  describeCommits,
  describeDependencies,
  describeNotes,
  describePushes,
  describeReleases,
  includedEvents,
  outcomeOf,
} from './describe'
import { eventsOf, pluralize, toBulletList } from './utils'
import type { EventPayload, SessionPayload } from '../../types'
import type { StoryCommit } from '../../../summary/story-commits'
import type { OutcomeWording } from './types'

interface BranchGroup {
  branch: string | null
  events: EventPayload[]
  commits: StoryCommit[]
}

interface BranchBullets {
  branch: string | null
  bullets: string[]
}

/**
 * The session's events and commits, by branch in the order first seen. An event with no branch (outside a repo,
 * a detached HEAD) stays with the branch before it; a commit on no known branch goes to the first.
 */
function groupByBranch(session: SessionPayload, events: EventPayload[]): BranchGroup[] {
  const order = session.branches.length > 0 ? session.branches : [null]
  const groups = new Map<string | null, BranchGroup>(
    order.map((branch) => [branch, { branch, events: [], commits: [] }])
  )
  let current = order[0]
  for (const event of events) {
    if (event.branch !== null && groups.has(event.branch)) current = event.branch
    groups.get(current)?.events.push(event)
  }
  for (const commit of session.commits) {
    const branch = commit.branch !== null && groups.has(commit.branch) ? commit.branch : order[0]
    groups.get(branch)?.commits.push(commit)
  }
  return [...groups.values()]
}

/** How the runs turned out, without counting them: "Tests now passing", not "Ran tests (20 runs)". */
function describeResult(events: EventPayload[], wording: OutcomeWording): string | null {
  const outcome = outcomeOf(eventsOf(events, wording.category))
  return outcome === null ? null : wording[outcome]
}

/** What was done on one branch, most telling first: commits, outcomes, then releases and pushes. */
function branchBullets(group: BranchGroup): string[] {
  return [
    ...describeCommits(group.commits.map((commit) => commit.subject)),
    describeResult(group.events, STORY_TEST_WORDING),
    describeResult(group.events, STORY_BUILD_WORDING),
    ...describeDependencies(group.events, { withRunCount: false }),
    describeReleases(group.events),
    describePushes(group.events),
  ].filter((bullet): bullet is string => bullet !== null)
}

interface CappedGroups {
  shown: BranchBullets[]
  hiddenBranches: string[]
}

/**
 * At most MAX_SESSION_BULLETS work bullets. Every branch keeps its first, so none disappears; the rest fill in, in
 * branch order. Past MAX_STORY_BRANCHES branches, the others are named in one closing line instead.
 */
function capGroups(groups: BranchBullets[]): CappedGroups {
  const hasTooManyBranches = groups.length > MAX_SESSION_BULLETS
  const kept = hasTooManyBranches ? groups.slice(0, MAX_STORY_BRANCHES) : groups
  const hiddenBranches = hasTooManyBranches
    ? groups.slice(MAX_STORY_BRANCHES).flatMap((group) => (group.branch === null ? [] : [group.branch]))
    : []
  let spareBullets = Math.max(0, MAX_SESSION_BULLETS - kept.length - (hasTooManyBranches ? 1 : 0))
  const shown: BranchBullets[] = []
  for (const group of kept) {
    const extra = group.bullets.slice(1, 1 + spareBullets)
    spareBullets -= extra.length
    shown.push({ branch: group.branch, bullets: [group.bullets[0], ...extra] })
  }
  return { shown, hiddenBranches }
}

/** "With an AI coding assistant (126 commands) · 3 file saves in the editor" — how, not what, so it comes last. */
function describeActivityLine(session: SessionPayload, events: EventPayload[]): string | null {
  const agentCommands = session.events.filter(
    (event) => event.source !== undefined && AGENT_SOURCES.includes(event.source)
  ).length
  const saves = eventsOf(events, 'code_edit').length
  const parts = [
    agentCommands > 0 ? `With an AI coding assistant (${pluralize(agentCommands, 'command')})` : null,
    saves > 0 ? `${pluralize(saves, 'file save')} in the editor` : null,
  ].filter((part): part is string => part !== null)
  return parts.length > 0 ? parts.join(' · ') : null
}

/** A session with nothing to tell but activity says so plainly — the heading already says where and how long. */
function describeQuietSession(session: SessionPayload, events: EventPayload[]): string {
  const ranCommands = session.events.some((event) => event.category !== 'code_edit' && event.category !== 'note')
  const hasOnlySaves = !ranCommands && eventsOf(events, 'code_edit').length > 0
  return hasOnlySaves ? 'Edited files' : 'Explored and ran commands'
}

function branchLines(capped: CappedGroups, isMultiBranch: boolean): string[] {
  const lines = capped.shown.flatMap((group) => {
    const bullets = toBulletList(group.bullets).split('\n')
    return isMultiBranch && group.branch !== null ? [`On ${group.branch}:`, ...bullets] : bullets
  })
  const hiddenCount = capped.hiddenBranches.length
  if (hiddenCount === 0) return lines
  const branchWord = hiddenCount === 1 ? 'branch' : 'branches'
  return [...lines, `Also on ${hiddenCount} more ${branchWord}: ${capped.hiddenBranches.join(', ')}`]
}

/** The story's lines under the heading: `- ` bullets, plain `On <branch>:` lines and a plain activity line. */
export function storyLines(session: SessionPayload, includeCategories: string[] = []): string[] {
  const events = includedEvents(session.events, includeCategories)
  const notes = describeNotes(events)
  const groups = groupByBranch(session, events)
    .map((group) => ({ branch: group.branch, bullets: branchBullets(group) }))
    .filter((group) => group.bullets.length > 0)
  const activityLine = describeActivityLine(session, events)
  const closing = activityLine === null ? [] : [activityLine]

  if (notes.length === 0 && groups.length === 0) {
    return [`- ${describeQuietSession(session, events)}`, ...closing]
  }
  const noteLines = notes.length > 0 ? toBulletList(notes).split('\n') : []
  return [...noteLines, ...branchLines(capGroups(groups), session.branches.length > 1), ...closing]
}

/**
 * A session's finished summary, heading included — the one renderer `summary`, `export` and `context` share, so
 * every consumer (the terminal, Slack, the VS Code tab and tooltip) gets the same `## `, `- ` and plain lines.
 */
export function renderSessionStory(session: SessionPayload, includeCategories: string[] = []): string {
  return [formatSessionHeading(session), ...storyLines(session, includeCategories)].join('\n')
}
