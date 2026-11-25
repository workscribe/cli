// A day's session as a story: notes first, then what was done on each branch — commits, then outcomes, then what
// shipped and how you moved between branches — and the agent and editor activity in one closing line. Nothing is
// cut or folded: every commit and every move is told, so the story is a full record you can retrace. Pure.
import { formatSessionHeading } from '../../../summary/heading'
import { agentWorkOf, editorSavesOf, isAgentEvent } from './agents'
import { changedFilesOf, describeChangedFiles } from './changes'
import { latestRecapOf, shortRecap } from './recap'
import { STORY_BUILD_WORDING, STORY_TEST_WORDING } from './constants'
import {
  describeDependencies,
  describeNotes,
  describePushes,
  describeReleases,
  includedEvents,
  outcomeOf,
} from './describe'
import { describeBranchMoves } from './branch-moves'
import { describeReads } from './reads'
import { topicOf } from './topic'
import { eventsOf, pluralize, toBulletList } from './utils'
import type { AgentSessionPayload, EventPayload, SessionPayload } from '../../types'
import type { StoryCommit } from '../../../summary/story-commits'
import type { OutcomeWording } from './types'

/** One branch's share of a session: its events, the commits made on it and the branch moves that happened on it. */
export interface BranchGroup {
  branch: string | null
  events: EventPayload[]
  commits: StoryCommit[]
  /** Branch moves (a branch created, a stash moved, a rebase, a discard) that happened on this branch */
  moves: string[]
  /** The agent conversations this branch's events came from, with their recaps */
  agentSessions: AgentSessionPayload[]
}

interface BranchBullets {
  branch: string | null
  bullets: string[]
}

/** The session's agent conversations that these events came from. */
function agentSessionsOf(session: SessionPayload, events: EventPayload[]): AgentSessionPayload[] {
  const ids = new Set(events.flatMap((event) => event.agentSessionId ?? []))
  return (session.agentSessions ?? []).filter((agentSession) => ids.has(agentSession.id))
}

/**
 * The session's events, commits and branch moves, by branch in the order first seen. An event with no branch
 * (outside a repo, a detached HEAD) stays with the branch before it; a commit or move on no known branch goes to the
 * first. Moves are read from every event, whatever the summary leaves out.
 */
function groupByBranch(session: SessionPayload, events: EventPayload[]): BranchGroup[] {
  const order = session.branches.length > 0 ? session.branches : [null]
  const groups = new Map<string | null, BranchGroup>(
    order.map((branch) => [branch, { branch, events: [], commits: [], moves: [], agentSessions: [] }])
  )
  const groupOf = (branch: string | null): BranchGroup | undefined =>
    groups.get(branch !== null && groups.has(branch) ? branch : order[0])
  let current = order[0]
  for (const event of events) {
    if (event.branch !== null && groups.has(event.branch)) current = event.branch
    groups.get(current)?.events.push(event)
  }
  for (const group of groups.values()) group.agentSessions = agentSessionsOf(session, group.events)
  for (const commit of session.commits) groupOf(commit.branch)?.commits.push(commit)
  for (const move of describeBranchMoves(session.events)) groupOf(move.branch)?.moves.push(move.line)
  return [...groups.values()]
}

/** How the runs turned out, without counting them: "Tests now passing", not "Ran tests (20 runs)". */
function describeResult(events: EventPayload[], wording: OutcomeWording): string | null {
  const outcome = outcomeOf(eventsOf(events, wording.category))
  return outcome === null ? null : wording[outcome]
}

/** What was done on one branch, most telling first: commits, outcomes, releases and pushes, then branch moves. */
function branchBullets(group: BranchGroup): string[] {
  return [
    ...group.commits.map((commit) => `Committed: ${commit.subject}`),
    describeChangedFiles(group.events),
    describeResult(group.events, STORY_TEST_WORDING),
    describeResult(group.events, STORY_BUILD_WORDING),
    ...describeDependencies(group.events, { withRunCount: false }),
    describeReleases(group.events),
    describePushes(group.events),
    ...group.moves,
  ].filter((bullet): bullet is string => bullet !== null)
}

/**
 * "With Claude Code: added branch-move reading (2 sessions, 14 files changed)" when an agent session left a recap,
 * else "With Claude Code (2 sessions)". Agents are read from every event (`allEvents`), excluded categories too.
 */
function describeAgentPart(allEvents: EventPayload[], agentSessions: AgentSessionPayload[]): string | null {
  const work = agentWorkOf(allEvents)
  if (work === null) return null
  const sessionCount = pluralize(work.sessionIds.size, 'session')
  const recap = latestRecapOf(agentSessions.filter((agentSession) => work.sessionIds.has(agentSession.id)))
  if (recap === null) return `With ${work.names}${work.sessionIds.size > 0 ? ` (${sessionCount})` : ''}`
  const files = changedFilesOf(allEvents.filter(isAgentEvent))?.total.files ?? 0
  const counts = [
    work.sessionIds.size > 0 ? sessionCount : null,
    files > 0 ? `${pluralize(files, 'file')} changed` : null,
  ].filter((count): count is string => count !== null)
  return `With ${work.names}: ${shortRecap(recap)}${counts.length > 0 ? ` (${counts.join(', ')})` : ''}`
}

/** "With Claude Code (2 sessions) · 3 file saves in the editor" — how, not what, so it comes last. */
function describeActivityLine(
  allEvents: EventPayload[],
  events: EventPayload[],
  agentSessions: AgentSessionPayload[]
): string | null {
  // An agent's edits aren't saves in the editor: they're the agent's work, which the agent part names
  const saves = editorSavesOf(events).length
  const parts = [
    describeAgentPart(allEvents, agentSessions),
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

function branchLines(groups: BranchBullets[], isMultiBranch: boolean): string[] {
  return groups.flatMap((group) => {
    const bullets = toBulletList(group.bullets).split('\n')
    return isMultiBranch && group.branch !== null ? [`On ${group.branch}:`, ...bullets] : bullets
  })
}

/** What each branch's events read, from every event: reads are `exploring`, which the story otherwise leaves out. */
function readsByBranch(session: SessionPayload): Map<string | null, string | null> {
  return new Map(branchGroupsOf(session).map((group) => [group.branch, describeReads(group.events)]))
}

/**
 * A branch's bullets with what it was about and what it read in front: the topic from its ticket and slug, but only for
 * a branch no commit names the work of and that has something else to tell — it never stands alone.
 */
function bulletsWithContext(group: BranchGroup, readLine: string | null | undefined): string[] {
  const bullets = [...(readLine ? [readLine] : []), ...branchBullets(group)]
  const topic = group.commits.length === 0 && bullets.length > 0 ? topicOf(group.branch) : null
  return topic === null ? bullets : [topic, ...bullets]
}

/** The story's lines under the heading: `- ` bullets, plain `On <branch>:` lines and a plain activity line. */
export function storyLines(session: SessionPayload, includeCategories: string[] = []): string[] {
  const events = includedEvents(session.events, includeCategories)
  const notes = describeNotes(events)
  const reads = readsByBranch(session)
  const groups = groupByBranch(session, events)
    .map((group) => ({ branch: group.branch, bullets: bulletsWithContext(group, reads.get(group.branch)) }))
    .filter((group) => group.bullets.length > 0)
  const activityLine = describeActivityLine(session.events, events, session.agentSessions ?? [])
  const closing = activityLine === null ? [] : [activityLine]

  if (notes.length === 0 && groups.length === 0) {
    return [`- ${describeQuietSession(session, events)}`, ...closing]
  }
  const noteLines = notes.length > 0 ? toBulletList(notes).split('\n') : []
  return [...noteLines, ...branchLines(groups, session.branches.length > 1), ...closing]
}

/**
 * A session's finished summary, heading included — the one renderer `summary`, `export` and `context` share, so
 * every consumer (the terminal, Slack, the VS Code tab and tooltip) gets the same `## `, `- ` and plain lines.
 */
export function renderSessionStory(session: SessionPayload, includeCategories: string[] = []): string {
  return [formatSessionHeading(session), ...storyLines(session, includeCategories)].join('\n')
}

/**
 * A session's branches with what happened on each — every event, included or not, so a branch's activity can be
 * counted like a day's. The week splits each thread this way before merging its branches across days, so a thread's
 * events with no branch stay with that thread's branch.
 */
export function branchGroupsOf(session: SessionPayload): BranchGroup[] {
  return groupByBranch(session, session.events)
}

/** What one branch's story says: its notes, then what was done on it, and how — told like a day's branch. */
export function storyOfBranch(
  group: BranchGroup,
  includeCategories: string[] = []
): { bullets: string[]; activity: string | null } {
  const events = includedEvents(group.events, includeCategories)
  return {
    bullets: [...describeNotes(events), ...branchBullets({ ...group, events })],
    activity: describeActivityLine(group.events, events, group.agentSessions),
  }
}
