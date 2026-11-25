// What changed in a stretch of work: the files with a `code_edit`, how many lines were added and removed, and who
// changed them — the editor, or a coding agent by name. Counts, never text. Pure.
import { agentNameOf } from './agents'
import { pluralize } from './utils'
import type { CommitSize } from '../../../summary/git-commits'
import type { EventPayload } from '../../types'

const EDITOR_LABEL = 'in the editor'

export interface ChangeTotals {
  files: number
  /** The sum of the known counts; null when no edit had one */
  linesAdded: number | null
  linesRemoved: number | null
}

/** Who changed files, and how much: the editor ("in the editor") or one agent ("with Claude Code"). */
export interface ChangesBy extends ChangeTotals {
  label: string
}

export interface ChangedFiles {
  total: ChangeTotals
  by: ChangesBy[]
  /** Edits stored before their file was kept: told, but not counted as files */
  unnamedEdits: number
}

export function knownCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function addKnown(total: number | null, count: number | null): number | null {
  if (count === null) return total
  return (total ?? 0) + count
}

interface Tally {
  files: ReadonlySet<string>
  linesAdded: number | null
  linesRemoved: number | null
}

const EMPTY_TALLY: Tally = { files: new Set(), linesAdded: null, linesRemoved: null }

/** The sum of the known counts; null when none is known. */
export function sumKnown(values: (number | null)[]): number | null {
  return values.reduce<number | null>((total, value) => addKnown(total, value), null)
}

function withEdit(tally: Tally, event: EventPayload, filePath: string): Tally {
  return {
    files: new Set([...tally.files, filePath]),
    linesAdded: addKnown(tally.linesAdded, knownCount(event.metadata.linesAdded)),
    linesRemoved: addKnown(tally.linesRemoved, knownCount(event.metadata.linesRemoved)),
  }
}

function totalsOf({ files, linesAdded, linesRemoved }: Tally): ChangeTotals {
  return { files: files.size, linesAdded, linesRemoved }
}

function labelOf(event: EventPayload): string {
  const agent = agentNameOf(event.source)
  return agent === null ? EDITOR_LABEL : `with ${agent}`
}

/**
 * The files changed by these events. An edit with no file path (a row from before paths were kept) isn't a file, but
 * is counted in `unnamedEdits`; an edit with no counts is a file that adds nothing to the line totals. Null when no
 * edit names a file.
 */
export function changedFilesOf(events: EventPayload[]): ChangedFiles | null {
  const edits = events.filter((event) => event.category === 'code_edit')
  const named = edits.flatMap((event) => (event.filePath === undefined ? [] : [{ event, filePath: event.filePath }]))
  if (named.length === 0) return null
  const byLabel = new Map<string, Tally>()
  let total = EMPTY_TALLY
  for (const { event, filePath } of named) {
    const label = labelOf(event)
    byLabel.set(label, withEdit(byLabel.get(label) ?? EMPTY_TALLY, event, filePath))
    total = withEdit(total, event, filePath)
  }
  return {
    total: totalsOf(total),
    by: [...byLabel.entries()].map(([label, tally]) => ({ label, ...totalsOf(tally) })),
    unnamedEdits: edits.length - named.length,
  }
}

/** "+320 −85"; only the known side when the other is unknown; null when neither is. */
function describeLines({ linesAdded, linesRemoved }: ChangeTotals): string | null {
  const parts = [linesAdded === null ? null : `+${linesAdded}`, linesRemoved === null ? null : `−${linesRemoved}`]
  const known = parts.filter((part): part is string => part !== null)
  return known.length > 0 ? known.join(' ') : null
}

/** "5 files, +86 −31" — what a commit changed, for the line that tells it. */
export function describeCommitSize({ files, added, removed }: CommitSize): string {
  return `${pluralize(files, 'file')}, ${describeLines({ files, linesAdded: added, linesRemoved: removed })}`
}

function withLines(text: string, totals: ChangeTotals): string {
  const lines = describeLines(totals)
  return lines === null ? text : `${text} (${lines})`
}

/**
 * "Changed 14 files (+320 −85)". The editor and the agents are told apart once both changed files:
 * "Changed 14 files (+320 −85): 9 in the editor (+200 −40), 6 with Claude Code (+120 −45); 1 file changed by both".
 * One agent alone is "Changed 5 files (+120 −45) with Claude Code". Earlier edits that kept no file are added last:
 * ", plus 2 earlier edits with no file recorded". Null when no edit names a file.
 */
export function describeChangedFiles(events: EventPayload[]): string | null {
  const changes = changedFilesOf(events)
  if (changes === null) return null
  const told = describeWho(changes)
  const unnamed = changes.unnamedEdits
  return unnamed > 0 ? `${told}, plus ${pluralize(unnamed, 'earlier edit')} with no file recorded` : told
}

/** The headline, and who made the changes. */
function describeWho(changes: ChangedFiles): string {
  const headline = withLines(`Changed ${pluralize(changes.total.files, 'file')}`, changes.total)
  const [only, ...others] = changes.by
  if (others.length > 0) {
    const parts = changes.by.map((who) => withLines(`${who.files} ${who.label}`, who))
    return `${headline}: ${parts.join(', ')}${describeOverlap(changes)}`
  }
  return only.label === EDITOR_LABEL ? headline : `${headline} ${only.label}`
}

/** "; 1 file changed by both" when the parts add up to more files than were changed. */
function describeOverlap({ total, by }: ChangedFiles): string {
  const both = by.reduce((sum, who) => sum + who.files, 0) - total.files
  return both > 0 ? `; ${pluralize(both, 'file')} changed by both` : ''
}
