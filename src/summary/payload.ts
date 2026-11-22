import os from 'os'
import path from 'path'
import { formatDate } from '../utils/format'
import { parseMetadata } from './event-metadata'
import { storyCommitsOf } from './story-commits'
import { isFailedCommand } from './commits'
import { isShellExpansion, withoutShellExpansions } from '../normalize/dependency-metadata'
import { gitMovesOf, type GitMove } from '../normalize/git-move'
import type { AgentSessionPayload, EventPayload, SessionPayload } from '../ai/types'
import type { AgentSessionInfo } from '../db/agent-sessions'
import type { EventRow } from '../db/types'
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
  /** Whether stored agent recaps go into the payload: only while `capture.agentMessages` is on */
  showAgentRecaps?: boolean
}

export function locationContextFrom(
  config: Pick<WorkscribeConfig, 'projects'> & Partial<Pick<WorkscribeConfig, 'capture'>>
): LocationContext {
  return {
    projects: config.projects ?? {},
    homeDir: os.homedir(),
    showAgentRecaps: config.capture?.agentMessages === true,
  }
}

const DEFAULT_LOCATION_CONTEXT: LocationContext = { projects: {}, homeDir: os.homedir() }

// Only git commands can move work between branches; anything else isn't worth parsing
const MENTIONS_GIT = /(^|[\s;&|(])git\s/

type BranchMove = Extract<GitMove, { kind: 'create-branch' | 'switch' }>

const isBranchMove = (move: GitMove): move is BranchMove => move.kind === 'create-branch' || move.kind === 'switch'

const isNamedByExpansion = (move: GitMove): boolean => isBranchMove(move) && isShellExpansion(move.branch)

/**
 * A branch the shell expanded (`git switch -c $B main`) is stored as written, so its name would be the variable's.
 * When the command succeeded and that was its last branch move, the branch the event ended on is the real name. Any
 * other such move is left out, and so is every one of a failed command's: it ended on the old branch, and a wrong name
 * is worse than none.
 */
function withResolvedBranchNames(moves: GitMove[], row: EventRow): GitMove[] {
  if (!moves.some(isNamedByExpansion)) return moves
  const lastBranchMove = moves.map(isBranchMove).lastIndexOf(true)
  const endedOn = isFailedCommand(row) ? null : row.branch
  return moves.flatMap((move, index) => {
    if (!isBranchMove(move) || !isNamedByExpansion(move)) return [move]
    return index === lastBranchMove && endedOn !== null ? [{ ...move, branch: endedOn }] : []
  })
}

/**
 * The command's branch moves, read from the stored (redacted) command. When the command failed, there's no telling
 * which step did — except that a new branch the session is now on was created (`git switch -c x && npm test` with
 * failing tests), so only that move is kept.
 */
function gitMovesField(row: EventRow): Pick<EventPayload, 'gitMoves'> {
  if (!MENTIONS_GIT.test(row.command)) return {}
  const moves = withResolvedBranchNames(gitMovesOf(row.command), row)
  const gitMoves = isFailedCommand(row)
    ? moves.filter((move) => move.kind === 'create-branch' && move.branch === row.branch)
    : moves
  return gitMoves.length > 0 ? { gitMoves } : {}
}

/** Package names stored before WOR-196 can hold shell expansions (`$(cat list.txt)` stored as two words). */
function metadataOf(row: EventRow): Record<string, unknown> {
  const metadata = parseMetadata(row.metadata)
  if (row.category !== 'dependencies' || !Array.isArray(metadata.packages)) return metadata
  const names = metadata.packages.filter((name): name is string => typeof name === 'string')
  return { ...metadata, packages: withoutShellExpansions(names) }
}

export function eventRowToPayload(row: EventRow): EventPayload {
  const metadata = metadataOf(row)
  const payload: EventPayload = {
    category: row.category,
    metadata,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
    branch: row.branch,
    capturedAt: row.captured_at,
    ...(row.source ? { source: row.source } : {}),
    ...(row.agent_session_id == null ? {} : { agentSessionId: row.agent_session_id }),
    ...(row.category === 'code_edit' && row.file_path ? { filePath: row.file_path } : {}),
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

/** What naming a stretch of work by its folders reads: its project's name, null outside any project. */
interface WorkEvents {
  repoName: string | null
  events: EventRow[]
}

/** The directory most of a stretch of work's events ran in, or null when it has no events. */
export function mostFrequentCwd(work: Pick<WorkEvents, 'events'>): string | null {
  return mostFrequentCwdOf(work.events)
}

/**
 * A directory inside a thread's repo, for git lookups: the most-used one among its events captured inside a repo,
 * else its most-used one. It doesn't match `repo_name` against a name — a project's name can differ from the text
 * its events were stored under. (Agents often run `cd repo && …` from a parent folder, so the most-used folder
 * overall can miss the repo.)
 */
export function threadRepoCwd(events: EventRow[]): string | null {
  return mostFrequentCwdOf(events.filter((event) => event.repo_name !== null)) ?? mostFrequentCwdOf(events)
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
export function sessionLocation(work: WorkEvents, context: LocationContext = DEFAULT_LOCATION_CONTEXT): string | null {
  if (work.repoName) return work.repoName
  const cwd = mostFrequentCwd(work)
  if (!cwd) return null
  return context.projects[cwd] ?? homeRelative(cwd, context.homeDir)
}

export interface SessionPayloadOptions {
  /** How to name a session outside git */
  context?: LocationContext
  /** The session's commits from `git log`, or null when git wasn't asked — captured ones are always used */
  gitCommits?: GitCommit[] | null
  /** The agent conversations the events came from */
  agentSessions?: AgentSessionInfo[]
}

function toAgentSessionPayloads(sessions: AgentSessionInfo[], context: LocationContext): AgentSessionPayload[] {
  return sessions.map(({ id, source, lastSeenAt, recap }) => ({
    id,
    source,
    lastSeenAt,
    recap: context.showAgentRecaps === true ? recap : null,
  }))
}

/** A stretch of work as the template tells it: the thread `context` answers with, or a thread of the day. */
export interface PayloadSpan extends WorkEvents {
  startedAt: string
  endedAt: string
  durationMinutes: number
}

export function spanToPayload(
  span: PayloadSpan,
  date: string,
  { context = DEFAULT_LOCATION_CONTEXT, gitCommits = null, agentSessions = [] }: SessionPayloadOptions = {}
): SessionPayload {
  return {
    date,
    project: sessionLocation(span, context),
    branch: sessionBranch(span.events),
    branches: branchesOf(span.events),
    startTime: formatDate(span.startedAt),
    endTime: formatDate(span.endedAt),
    durationMinutes: span.durationMinutes,
    events: span.events.map(eventRowToPayload),
    ...(agentSessions.length > 0 ? { agentSessions: toAgentSessionPayloads(agentSessions, context) } : {}),
    commits: storyCommitsOf(span.events, gitCommits),
  }
}

/** One thread of a block as the template tells it: its own span and active time, and the projects alongside it. */
export function threadToPayload(
  thread: DayThread,
  block: DayBlock,
  options: SessionPayloadOptions = {}
): SessionPayload {
  const durationMinutes = minutesBetween(thread.startedAt, thread.endedAt)
  return {
    ...spanToPayload({ ...thread, durationMinutes }, block.date, { ...options, agentSessions: thread.agentSessions }),
    activeMinutes: toActiveMinutes(thread.activeSlots),
    projectId: thread.projectId,
    alongside: block.threads
      .filter((other) => other.id !== thread.id)
      .map((other) => sessionLocation(other, options.context) ?? UNKNOWN_LOCATION),
  }
}
