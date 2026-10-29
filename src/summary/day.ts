// A day's summary, the way `summary` and `export` both tell it: a saved summary where the agent skill (or a 1.x AI
// provider) wrote one, and the template's story for the rest, with the day's git commits looked up just for those.
import { getSessionSummaries } from '../db'
import { DAY_GIT_BUDGET_MS, lookupDayCommits } from './day-commits'
import { locationContextFrom, sessionToPayload } from './payload'
import { pickSavedSummary, sessionKey, type SavedSummary } from './store'
import type { AIProvider, SessionPayload } from '../ai/types'
import type { WorkscribeConfig } from '../config'
import type { Session } from '../sessions/detector'

export interface RenderDayOptions {
  date: string
  sessions: Session[]
  config: WorkscribeConfig
  /** What writes the summaries the skill didn't (the template) */
  provider: AIProvider
  /** Ignore saved summaries and tell every session with the template */
  fresh?: boolean
}

export interface RenderedDay {
  sessionPayloads: SessionPayload[]
  /** Per session: the saved summary shown, or null where the template told it */
  saved: (SavedSummary | null)[]
  /** Per session: its finished text, heading included */
  summaries: string[]
  /** Every session's text, separated by a blank line */
  fullSummary: string
  /** Whether the template told any session — the left-out events footer only applies then */
  needsGeneration: boolean
}

/** Each session's summary for the day. Throws when the writer fails, so the command can say so and stop. */
export async function renderDay({
  date,
  sessions,
  config,
  provider,
  fresh = false,
}: RenderDayOptions): Promise<RenderedDay> {
  const saved = sessions.map((session) =>
    fresh ? null : pickSavedSummary(getSessionSummaries(sessionKey(session.repoName, session.startedAt)))
  )
  // git is only asked about the sessions the template tells, within one budget for the run
  const toRender = sessions.filter((_session, index) => saved[index] === null)
  const commitsToRender = lookupDayCommits(toRender, { budgetMs: DAY_GIT_BUDGET_MS })
  const gitCommitsBySession = new Map(toRender.map((session, index) => [session, commitsToRender[index]]))
  const context = locationContextFrom(config)
  const sessionPayloads = sessions.map((session) =>
    sessionToPayload(session, date, { context, gitCommits: gitCommitsBySession.get(session) ?? null })
  )

  const summaries: string[] = []
  for (const [index, sessionPayload] of sessionPayloads.entries()) {
    const savedSummary = saved[index]
    // The writer returns the session's finished story, heading included
    summaries.push(
      savedSummary ? savedSummary.text : (await provider.summarize({ date, sessions: [sessionPayload] })).trim()
    )
  }
  return {
    sessionPayloads,
    saved,
    summaries,
    fullSummary: summaries.join('\n\n'),
    needsGeneration: saved.some((entry) => entry === null),
  }
}
