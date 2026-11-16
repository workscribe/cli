// The one edit shape: how many lines an edit added and removed — never the text. Pure, so capture and the database's
// merge share it without I/O.
import { parseMetadata } from '../summary/event-metadata'

/** An edit's line counts; null when the sender couldn't tell (an older extension, a Write over an unknown file). */
export interface EditCounts {
  linesAdded: number | null
  linesRemoved: number | null
}

/** Lines in a text: a trailing newline ends the last line rather than starting another. */
export function lineCount(text: string): number {
  if (text === '') return 0
  return text.endsWith('\n') ? text.split('\n').length - 1 : text.split('\n').length
}

/** `lineCount` of a payload field, or null when it isn't text. */
export function optionalLineCount(value: unknown): number | null {
  return typeof value === 'string' ? lineCount(value) : null
}

const NON_NEGATIVE_INTEGER = /^\d+$/

/**
 * A `--lines-added`/`--lines-removed` value: a non-negative integer, else unknown — never a failed capture. A flag
 * given with no value arrives as `true`.
 */
export function parseLineCount(value: unknown): number | null {
  if (typeof value !== 'string' || !NON_NEGATIVE_INTEGER.test(value.trim())) return null
  const count = Number(value.trim())
  return Number.isSafeInteger(count) ? count : null
}

/** A new `code_edit`'s metadata: both counts, null when unknown, so every edit has the same shape. */
export function editMetadata(counts: EditCounts): string {
  return JSON.stringify({ linesAdded: counts.linesAdded, linesRemoved: counts.linesRemoved })
}

function storedCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
}

/** The sum of the known counts; unknown only while neither side knew it. */
function addCounts(stored: number | null, added: number | null): number | null {
  if (stored === null) return added
  return added === null ? stored : stored + added
}

/**
 * A repeated edit added onto the stored event: the counts add up and `lastEditAt` moves to this edit. A row from before
 * line counts (`metadata: null`) or with corrupt metadata counts as unknown.
 */
export function mergedEditMetadata(storedMetadata: string | null, edit: EditCounts, editedAt: string): string {
  const stored = parseMetadata(storedMetadata)
  return JSON.stringify({
    ...stored,
    linesAdded: addCounts(storedCount(stored.linesAdded), edit.linesAdded),
    linesRemoved: addCounts(storedCount(stored.linesRemoved), edit.linesRemoved),
    lastEditAt: editedAt,
  })
}
