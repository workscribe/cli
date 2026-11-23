import { pickSavedSummary } from './store'
import { toPlainText } from './plain-text'
import type { SummaryFormat } from './output-format'

// What `summary` and `export` show for a day whose captured events were removed (WOR-179): the summaries saved for it.
// A summary is kept with its day, so it can still be found after the events it described are gone. Pure.

export interface KeptSummaryRow {
  source_key: string | null
  engine: string
  text: string
  created_at: string
}

const REMOVED_NOTE =
  'The captured activity for this day has been removed. These are the summaries that were saved for it.'

/** One summary per thread, the best one, in the order they were saved. Template rows are stored leftovers and are not shown. */
export function keptSummaryTexts(rows: KeptSummaryRow[]): string[] {
  const byThread = new Map<string, KeptSummaryRow[]>()
  rows.forEach((row, index) => {
    // A row with no key describes no thread, so it stands alone
    const group = row.source_key ?? `row-${index}`
    byThread.set(group, [...(byThread.get(group) ?? []), row])
  })
  return [...byThread.values()]
    .map((group) => pickSavedSummary(group)?.text)
    .filter((text): text is string => text !== undefined)
}

/** The day as markdown: its summaries, then a note that explains why there is nothing else. */
export function renderKeptDay(summaries: string[]): string {
  return [...summaries, `_${REMOVED_NOTE}_`].join('\n\n')
}

export function renderKeptDayAs(format: SummaryFormat | undefined, date: string, summaries: string[]): string {
  if (format === 'json') {
    return JSON.stringify(
      { date, activeMinutes: null, sessions: [], activityRemoved: true, keptSummaries: summaries },
      null,
      2
    )
  }
  if (format === 'text') return toPlainText([...summaries, REMOVED_NOTE].join('\n\n'))
  return renderKeptDay(summaries)
}
