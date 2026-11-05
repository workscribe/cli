import { renderSessionStory } from './story'
import { renderWeek, weekLayoutOf } from './week'
import type { AIProvider, DaySummaryPayload, WeekSummaryPayload } from '../../types'

/** Offline, deterministic summaries built from captured events — the default when no AI is configured. */
export class TemplateProvider implements AIProvider {
  constructor(private includeCategories: string[] = []) {}

  /** Each session's story, heading included, separated by a blank line. */
  async summarize(payload: DaySummaryPayload): Promise<string> {
    return payload.sessions.map((session) => renderSessionStory(session, this.includeCategories)).join('\n\n')
  }

  /** The week by project then branch (the default), or day by day. */
  async summarizeWeek(payload: WeekSummaryPayload): Promise<string> {
    return renderWeek(weekLayoutOf(payload, this.includeCategories))
  }

  async validate(): Promise<void> {
    // Nothing to reach — the template engine runs entirely offline
  }
}
