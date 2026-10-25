import { formatSessionHeading, UNKNOWN_LOCATION } from '../../../summary/heading'
import { MAX_DAY_BULLETS } from './constants'
import { countIncludedEvents, describeActivity, describeSession } from './describe'
import { pluralize, toBulletList } from './utils'
import type { AIProvider, DaySummaryPayload, SessionPayload, WeekSummaryPayload } from '../../types'

/** One entry per location for the day — several sessions in the same repo read as one block of work. */
function mergeByLocation(sessions: SessionPayload[]): SessionPayload[] {
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

/** Offline, deterministic summaries built from captured events — the default when no AI is configured. */
export class TemplateProvider implements AIProvider {
  constructor(private includeCategories: string[] = []) {}

  async summarize(payload: DaySummaryPayload): Promise<string> {
    const [onlySession, ...otherSessions] = payload.sessions
    if (onlySession && otherSessions.length === 0) {
      return toBulletList(describeSession(onlySession, this.includeCategories))
    }
    // `export` summarizes a whole day at once, so each session gets its own heading
    return payload.sessions
      .map(
        (session) =>
          `${formatSessionHeading(session)}\n${toBulletList(describeSession(session, this.includeCategories))}`
      )
      .join('\n\n')
  }

  async summarizeWeek(payload: WeekSummaryPayload): Promise<string> {
    return payload.days
      .map((day) => `### ${day.date}\n${toBulletList(pickDayBullets(day.sessions, this.includeCategories))}`)
      .join('\n\n')
  }

  async validate(): Promise<void> {
    // Nothing to reach — the template engine runs entirely offline
  }
}
