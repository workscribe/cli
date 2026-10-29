// What `summary` and `export` print under a day's summary: which sessions came from saved summaries, and which
// events the template left out. Both go to the console — never into an exported file.
import chalk from 'chalk'
import { log } from '../utils/logger'
import { countExcludedEvents } from '../summary/exclusions'
import type { SessionPayload } from '../ai/types'
import type { SavedSummary } from '../summary/store'

export function printExcludedFooter(sessionPayloads: SessionPayload[], excluded: Set<string>): void {
  const excludedCounts = countExcludedEvents(sessionPayloads, excluded)
  if (excludedCounts.size === 0) return
  const total = [...excludedCounts.values()].reduce((sum, count) => sum + count, 0)
  const breakdown = [...excludedCounts.entries()].map(([category, count]) => `${category} ×${count}`).join(', ')
  log.plain(chalk.dim(`  ℹ ${total} event${total === 1 ? '' : 's'} not included in summary (${breakdown})`))
  log.plain(chalk.dim('    Use --verbose to inspect · workscribe config set summary.includeCategories to opt in'))
  log.plain('')
}

/** Says which sessions came from saved summaries, so it's clear why --fresh would change the output. */
export function printSavedNote(saved: (SavedSummary | null)[]): void {
  const fromSkill = saved.filter((entry) => entry?.fromSkill).length
  const fromLegacyProvider = saved.filter((entry) => entry && !entry.fromSkill).length
  const parts = [
    fromSkill > 0 ? `${fromSkill} written by the Workscribe agent skill` : null,
    fromLegacyProvider > 0 ? `${fromLegacyProvider} written by an AI provider in Workscribe 1.x` : null,
  ].filter((part): part is string => part !== null)
  if (parts.length === 0) return
  log.plain(chalk.dim(`  (${parts.join(', ')} — use --fresh for the template summary)`))
}
