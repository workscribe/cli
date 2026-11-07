import type { OutcomeWording } from './types'

// The week digest's caps — a day's story tells everything (story.ts)
export const MAX_SESSION_BULLETS = 7
export const MAX_COMMIT_BULLETS = 3
export const MAX_DAY_BULLETS = 5
export const MAX_LISTED_PACKAGES = 6

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

// A day's story says how runs turned out, not how many there were (the week digest above still counts them)
export const STORY_TEST_WORDING: OutcomeWording = {
  ...TEST_WORDING,
  resolved: 'Tests now passing',
  failing: 'Tests failing',
}

export const STORY_BUILD_WORDING: OutcomeWording = {
  ...BUILD_WORDING,
  resolved: 'Build now passing',
  passing: 'Build passing',
  failing: 'Build failing',
}
