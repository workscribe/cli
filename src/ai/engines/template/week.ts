// The week, in both its layouts (pure). By project (the default): each project, then each of its branches, with the
// dates it was worked on and what was done — told by the day's own branch story. Each thread is split by branch first
// and its branches merged across the week after, so a thread's events with no branch stay with that thread's branch.
// By day: the day-by-day digest, a few bullets a day taking turns across locations.
import { UNKNOWN_LOCATION } from '../../../summary/heading'
import { formatWeekday, localDateOf } from '../../../utils/format'
import { MAX_DAY_BULLETS } from './constants'
import { countIncludedEvents, describeActivity } from './describe'
import { branchGroupsOf, storyOfBranch, type BranchGroup } from './story'
import { pluralize, toBulletList } from './utils'
import type { SessionPayload, WeekSummaryPayload } from '../../types'

/** At most this many bullets per branch; the rest fold into "…plus N more". */
export const MAX_BRANCH_BULLETS = 6
const NO_BRANCH_LABEL = '(no branch)'
// A branch with nothing to tell but excluded activity still says it was worked on
const QUIET_BRANCH_BULLET = 'Explored and ran commands'

export interface BranchWeek {
  /** Null for work on no branch */
  branch: string | null
  /** The local days it had activity, in order */
  dates: string[]
  bullets: string[]
  /** How many bullets were folded away */
  moreCount: number
  activity: string | null
}

export interface ProjectWeek {
  project: string
  branches: BranchWeek[]
}

export interface DayWeek {
  date: string
  bullets: string[]
}

/** The week as laid out: what `summary.format=json` prints after `weekStart` and `weekEnd`, and what's rendered. */
export type WeekLayoutData = { by: 'project'; projects: ProjectWeek[] } | { by: 'day'; days: DayWeek[] }

/** A branch's merged group across the week, and the days it was worked on */
interface BranchAccumulator {
  group: BranchGroup
  dates: Set<string>
}

interface ProjectAccumulator {
  project: string
  /** Its branches, in the order first seen */
  branches: Map<string | null, BranchAccumulator>
}

/** The week groups by project identity; work outside any project (no id) by the folder it's named after. */
function projectKeyOf(session: SessionPayload): string {
  return session.projectId === undefined || session.projectId === null
    ? `name:${session.project ?? UNKNOWN_LOCATION}`
    : `id:${session.projectId}`
}

/**
 * A commit told twice: the same hash, or — for a captured commit git didn't return — the same subject at the same
 * time. Never by subject alone: two "wip" commits on different days are two commits.
 */
function commitKeyOf(commit: BranchGroup['commits'][number]): string {
  return commit.hash ?? `${commit.subject}@${commit.committedAt}`
}

function distinctCommits(commits: BranchGroup['commits']): BranchGroup['commits'] {
  const seen = new Set<string>()
  return commits.filter((commit) => {
    const key = commitKeyOf(commit)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

/** A thread's branch group merged into what the week has for that branch so far. */
function mergeBranch(existing: BranchAccumulator | undefined, group: BranchGroup, date: string): BranchAccumulator {
  const dates = new Set(group.events.map((event) => localDateOf(event.capturedAt)))
  if (dates.size === 0) dates.add(date)
  if (!existing) return { group, dates }
  return {
    group: {
      branch: group.branch,
      events: [...existing.group.events, ...group.events],
      commits: distinctCommits([...existing.group.commits, ...group.commits]),
      moves: [...existing.group.moves, ...group.moves],
    },
    dates: new Set([...existing.dates, ...dates]),
  }
}

function toBranchWeek({ group, dates }: BranchAccumulator, includeCategories: string[]): BranchWeek {
  const story = storyOfBranch(group, includeCategories)
  const bullets = story.bullets.length === 0 && story.activity === null ? [QUIET_BRANCH_BULLET] : story.bullets
  return {
    branch: group.branch,
    dates: [...dates].sort(),
    bullets: bullets.slice(0, MAX_BRANCH_BULLETS),
    moreCount: Math.max(0, bullets.length - MAX_BRANCH_BULLETS),
    activity: story.activity,
  }
}

/** Each project of the week, in the order of its first activity, with its branches in the order first seen. */
export function weekByProject(payload: WeekSummaryPayload, includeCategories: string[] = []): ProjectWeek[] {
  const projects = new Map<string, ProjectAccumulator>()
  for (const day of payload.days) {
    for (const session of day.sessions) {
      const key = projectKeyOf(session)
      const project = projects.get(key) ?? { project: session.project ?? UNKNOWN_LOCATION, branches: new Map() }
      projects.set(key, project)
      for (const group of branchGroupsOf(session)) {
        project.branches.set(group.branch, mergeBranch(project.branches.get(group.branch), group, day.date))
      }
    }
  }
  return [...projects.values()].map((project) => ({
    project: project.project,
    branches: [...project.branches.values()].map((branch) => toBranchWeek(branch, includeCategories)),
  }))
}

function renderBranch(branch: BranchWeek): string {
  const heading = `### ${branch.branch ?? NO_BRANCH_LABEL} — ${branch.dates.map(formatWeekday).join(', ')}`
  const more = branch.moreCount > 0 ? [`…plus ${branch.moreCount} more`] : []
  const bullets = [...branch.bullets, ...more]
  // A branch with only an activity line has no bullet list, and so no blank line where one would be
  const lines = [heading, ...(bullets.length === 0 ? [] : [toBulletList(bullets)])]
  return (branch.activity === null ? lines : [...lines, branch.activity]).join('\n')
}

/** The week as text: a `## project` section per project, a `### branch — dates` block per branch. */
export function renderWeekByProject(projects: ProjectWeek[]): string {
  return projects
    .map((project) => [`## ${project.project}`, ...project.branches.map(renderBranch)].join('\n\n'))
    .join('\n\n')
}

/** One entry per location for the day — several sessions in the same repo read as one block of work. */
export function mergeByLocation(sessions: SessionPayload[]): SessionPayload[] {
  const merged = new Map<string, SessionPayload>()
  for (const session of sessions) {
    const location = session.project ?? UNKNOWN_LOCATION
    const existing = merged.get(location)
    merged.set(
      location,
      existing
        ? {
            ...existing,
            events: [...existing.events, ...session.events],
            branches: [...new Set([...existing.branches, ...session.branches])],
            durationMinutes: existing.durationMinutes + session.durationMinutes,
          }
        : { ...session, project: location }
    )
  }
  return [...merged.values()]
}

function locationBullets(session: SessionPayload, includeCategories: string[]): string[] {
  const bullets = describeActivity(session, includeCategories)
  const lines = bullets.length > 0 ? bullets : [pluralize(countIncludedEvents(session, includeCategories), 'command')]
  return lines.map((line) => `${session.project}: ${line}`)
}

/** Takes the top bullet of every location, then the second, and so on — so one busy repo can't fill the day. */
function pickDayBullets(sessions: SessionPayload[], includeCategories: string[]): string[] {
  const perLocation = mergeByLocation(sessions).map((session) => locationBullets(session, includeCategories))
  const longest = Math.max(0, ...perLocation.map((bullets) => bullets.length))
  const interleaved = Array.from({ length: longest }, (_unused, index) =>
    perLocation.flatMap((bullets) => (index < bullets.length ? [bullets[index]] : []))
  ).flat()
  return interleaved.slice(0, MAX_DAY_BULLETS)
}

/** The week day by day (`--by day`): each day's bullets, taking turns across locations, at most 5 a day. */
export function weekByDay(payload: WeekSummaryPayload, includeCategories: string[] = []): DayWeek[] {
  return payload.days.map((day) => ({ date: day.date, bullets: pickDayBullets(day.sessions, includeCategories) }))
}

/** The week laid out as `payload.by` asks — the one place the two layouts are chosen between. */
export function weekLayoutOf(payload: WeekSummaryPayload, includeCategories: string[] = []): WeekLayoutData {
  if (payload.by === 'project') return { by: 'project', projects: weekByProject(payload, includeCategories) }
  return { by: 'day', days: weekByDay(payload, includeCategories) }
}

/** The laid-out week as text. */
export function renderWeek(layout: WeekLayoutData): string {
  if (layout.by === 'project') return renderWeekByProject(layout.projects)
  return layout.days.map((day) => `### ${day.date}\n${toBulletList(day.bullets)}`).join('\n\n')
}
