import os from 'os'
import path from 'path'
import { formatDate } from '../utils/format'
import { parseMetadata } from './event-metadata'
import { storyCommitsOf } from './story-commits'
import { isFailedCommand } from './commits'
import { gitMovesOf } from '../normalize/git-move'
import type { DaySummaryPayload, EventPayload, SessionPayload } from '../ai/types'
import type { EventRow } from '../db/types'
import type { Session } from '../sessions/detector'
import type { WorkscribeConfig } from '../config'
import type { GitCommit } from './git-commits'
import type { DayBlock, DayThread } from '../db/day-threads'
import { minutesBetween } from '../sessions/grouper'
import { toActiveMinutes } from '../sessions/blocks'
import { UNKNOWN_LOCATION } from './heading'

/** What sessionLocation needs to name a session that isn't in a git repo. */
export interface LocationContext {
  projects: Record<string, string>
  homeDir: string
}

export function locationContextFrom(config: Pick<WorkscribeConfig, 'projects'>): LocationContext {
  return { projects: config.projects ?? {}, homeDir: os.homedir() }
}

const DEFAULT_LOCATION_CONTEXT: LocationContext = { projects: {}, homeDir: os.homedir() }

// Only git commands can move work between branches; anything else isn't worth parsing
const MENTIONS_GIT = /(^|[\s;&|(])git\s/

/**
 * The command's branch moves, read from the stored (redacted) command. When the command failed, there's no telling
 * which step did — except that a new branch the session is now on was created (`git switch -c x && npm test` with
 * failing tests), so only that move is kept.
 */
function gitMovesField(row: EventRow): Pick<EventPayload, 'gitMoves'> {
  if (!MENTIONS_GIT.test(row.command)) return {}
  const moves = gitMovesOf(row.command)
  const gitMoves = isFailedCommand(row)
    ? moves.filter((move) => move.kind === 'create-branch' && move.branch === row.branch)
    : moves
  return gitMoves.length > 0 ? { gitMoves } : {}
}

export function eventRowToPayload(row: EventRow): EventPayload {
  const metadata = parseMetadata(row.metadata)
  const payload: EventPayload = {
    category: row.category,
    metadata,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
    branch: row.branch,
    capturedAt: row.captured_at,
    ...(row.source ? { source: row.source } : {}),
    ...gitMovesField(row),
  }
  if (row.category !== 'other' || typeof metadata.hint !== 'string') return payload

  // Unclassified commands carry their raw hint separately so the prompt can show it on its own
  const { hint, tool: _tool, ...rest } = metadata
  return { ...payload, hint, metadata: rest }
}

function branchesOnly(events: Pick<EventRow, 'branch'>[]): string[] {
  return events.map((event) => event.branch).filter((branch): branch is string => branch !== null)
}

/** The branches a session's events happened on: distinct, in the order first seen, events outside a repo skipped. */
export function branchesOf(events: Pick<EventRow, 'branch'>[]): string[] {
  return [...new Set(branchesOnly(events))]
}

/** The session's branch: the latest it was on — where the work was heading by the end. Null outside a repo. */
export function sessionBranch(events: Pick<EventRow, 'branch'>[]): string | null {
  return branchesOnly(events).at(-1) ?? null
}

function mostFrequentCwdOf(events: EventRow[]): string | null {
  const counts = new Map<string, number>()
  for (const event of events) counts.set(event.cwd, (counts.get(event.cwd) ?? 0) + 1)
  let best: string | null = null
  for (const [cwd, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = cwd
  }
  return best
}

/** What naming a session or thread by its folders reads. */
type WorkEvents = Pick<Session, 'repoName' | 'events'>

/** The directory most of a session's events ran in, or null for a session with no events. */
export function mostFrequentCwd(session: Pick<Session, 'events'>): string | null {
  return mostFrequentCwdOf(session.events)
}

/**
 * A directory inside a thread's repo, for git lookups: the most-used one among its events captured inside a repo,
 * else its most-used one. Unlike `repoCwd`, it doesn't match `repo_name` against a name — a project's name can
 * differ from the text its events were stored under.
 */
export function threadRepoCwd(events: EventRow[]): string | null {
  return mostFrequentCwdOf(events.filter((event) => event.repo_name !== null)) ?? mostFrequentCwdOf(events)
}

/**
 * A directory inside the session's repo, for git lookups. Agents often run `cd repo && …` from a
 * parent directory that isn't a repo, so the most-used directory overall can miss the repo entirely.
 */
export function repoCwd(session: Session): string | null {
  if (!session.repoName) return mostFrequentCwd(session)
  return mostFrequentCwdOf(session.events.filter((event) => event.repo_name === session.repoName))
}

function homeRelative(directory: string, homeDir: string): string {
  if (directory === homeDir) return '~'
  if (directory.startsWith(homeDir + path.sep)) return `~${directory.slice(homeDir.length)}`
  return directory
}

/**
 * The name a session is shown under: its repo, or — for work outside any git repo — the directory
 * most of its commands ran in (a config.projects name if one is set, else the home-relative path),
 * so the user can always tell where the work happened.
 */
export function sessionLocation(
  session: WorkEvents,
  context: LocationContext = DEFAULT_LOCATION_CONTEXT
): string | null {
  if (session.repoName) return session.repoName
  const cwd = mostFrequentCwd(session)
  if (!cwd) return null
  return context.projects[cwd] ?? homeRelative(cwd, context.homeDir)
}

export interface SessionPayloadOptions {
  /** How to name a session outside git */
  context?: LocationContext
  /** The session's commits from `git log`, or null when git wasn't asked — captured ones are always used */
  gitCommits?: GitCommit[] | null
}

export function sessionToPayload(
  session: Session,
  date: string,
  { context = DEFAULT_LOCATION_CONTEXT, gitCommits = null }: SessionPayloadOptions = {}
): SessionPayload {
  return {
    date,
    project: sessionLocation(session, context),
    branch: sessionBranch(session.events),
    branches: branchesOf(session.events),
    startTime: formatDate(session.startedAt),
    endTime: formatDate(session.endedAt),
    durationMinutes: session.durationMinutes,
    events: session.events.map(eventRowToPayload),
    commits: storyCommitsOf(session.events, gitCommits),
  }
}

/** One thread of a block as the template tells it: its own span and active time, and the projects alongside it. */
export function threadToPayload(
  thread: DayThread,
  block: DayBlock,
  { context = DEFAULT_LOCATION_CONTEXT, gitCommits = null }: SessionPayloadOptions = {}
): SessionPayload {
  return {
    date: block.date,
    project: sessionLocation(thread, context),
    branch: sessionBranch(thread.events),
    branches: branchesOf(thread.events),
    startTime: formatDate(thread.startedAt),
    endTime: formatDate(thread.endedAt),
    durationMinutes: minutesBetween(thread.startedAt, thread.endedAt),
    activeMinutes: toActiveMinutes(thread.activeSlots),
    alongside: block.threads
      .filter((other) => other.id !== thread.id)
      .map((other) => sessionLocation(other, context) ?? UNKNOWN_LOCATION),
    events: thread.events.map(eventRowToPayload),
    commits: storyCommitsOf(thread.events, gitCommits),
  }
}

export function buildDayPayload(
  date: string,
  sessions: Session[],
  context: LocationContext = DEFAULT_LOCATION_CONTEXT
): DaySummaryPayload {
  return { date, sessions: sessions.map((session) => sessionToPayload(session, date, { context })) }
}
