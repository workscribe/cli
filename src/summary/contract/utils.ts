import { eventRowToPayload } from '../payload'
import { buildExcludedSet } from '../exclusions'
import type { EventRow } from '../../db/types'

/** Events the contract reports: the AI engines' exclusions apply, and notes go to `notes` instead. */
export function contractEvents(rows: EventRow[], includeCategories: string[]): EventRow[] {
  const excluded = buildExcludedSet(includeCategories)
  return rows.filter((row) => row.category !== 'note' && !excluded.has(row.category))
}

export function collectNotes(rows: EventRow[]): string[] {
  return rows.flatMap((row) => {
    if (row.category !== 'note') return []
    const { text } = eventRowToPayload(row).metadata
    return typeof text === 'string' && text !== '' ? [text] : []
  })
}
