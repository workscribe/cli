import type { OutcomeWording } from './types'

export const MAX_SESSION_BULLETS = 7
export const MAX_COMMIT_BULLETS = 3
export const MAX_DAY_BULLETS = 5
export const MAX_LISTED_PACKAGES = 6

// Event sources that mean a coding agent ran the command (its hook captured it). Summaries count these,
// but never name the tool.
export const AGENT_SOURCES = ['claude-code']

export const TEST_WORDING: OutcomeWording = {
  category: 'testing',
  resolved: 'Resolved failing tests',
  passing: 'Tests passing',
  failing: 'Tests still failing',
  ran: 'Ran tests',
}

export const BUILD_WORDING: OutcomeWording = {
  category: 'building',
  resolved: 'Fixed a failing build',
  passing: 'Builds passing',
  failing: 'Build still failing',
  ran: 'Ran builds',
}
