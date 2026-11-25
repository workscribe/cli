// What a branch's `exploring` commands read, as one short line for the story: "Read the WOR-179 plan, the retention
// modules and tests in tests/db". It names areas, never raw commands and never more than four things. Pure.
import { DEFAULT_TICKET_KEY } from '../../../capture/tickets'
import { pluralize } from './utils'
import type { EventPayload } from '../../types'

const MAX_PHRASES = 4
/** A word at least this many of a folder's files share names them as modules, whatever the rest of the folder holds. */
const MIN_FILES_TO_NAME_A_WORD = 3
const MAX_TEST_FOLDERS_NAMED = 2
const FOLDER_LEVELS = 2
const REPOSITORY_ROOT = 'the repository root'

const PLAN_FOLDER = /(^|\/)plans?\//
const TEST_PATH = /(^|\/)(tests?|__tests__)\/|\.(test|spec)\./
const DOC_PATH = /(^|\/)docs?\/|\.md$/
// Words that name how a file is built, not what it is about
const FILLER_WORDS = new Set(['index', 'test', 'spec', 'types', 'type', 'utils', 'util', 'main', 'src'])

type PathKind = 'plan' | 'test' | 'doc' | 'source'

/** A folder (two levels deep) and the files of one kind read in it. */
interface FolderGroup {
  folder: string
  files: string[]
}

/** One thing the line says, and how many files it stands for (so what's folded away can still be counted). */
interface Phrase {
  text: string
  files: number
}

function ticketOf(filePath: string): string | null {
  return PLAN_FOLDER.test(filePath) ? (filePath.match(DEFAULT_TICKET_KEY)?.[0] ?? null) : null
}

/** What a path is, decided once: a plan names a ticket, tests and docs are told apart from source. */
function kindOf(filePath: string): PathKind {
  if (ticketOf(filePath) !== null) return 'plan'
  if (TEST_PATH.test(filePath)) return 'test'
  return DOC_PATH.test(filePath) ? 'doc' : 'source'
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

function folderOf(filePath: string): string {
  return filePath.split('/').slice(0, -1).slice(0, FOLDER_LEVELS).join('/')
}

function byCountThenName(first: FolderGroup, second: FolderGroup): number {
  return second.files.length - first.files.length || first.folder.localeCompare(second.folder)
}

/** The paths by their folder (two levels deep), the folder with the most first. */
function groupByFolder(paths: string[]): FolderGroup[] {
  const groups = new Map<string, string[]>()
  for (const filePath of paths) {
    const folder = folderOf(filePath)
    groups.set(folder, [...(groups.get(folder) ?? []), filePath])
  }
  return [...groups].map(([folder, files]) => ({ folder, files })).sort(byCountThenName)
}

function planPhrase(plans: string[]): Phrase[] {
  const tickets = [...new Set(plans.flatMap((filePath) => ticketOf(filePath) ?? []))]
  if (tickets.length === 0) return []
  const text = `the ${joinWithAnd(tickets)} ${tickets.length === 1 ? 'plan' : 'plans'}`
  return [{ text, files: plans.length }]
}

/** The words of a file's name, without its extension, split on `-`, `_`, `.` and camelCase. */
function wordsOf(filePath: string): string[] {
  const name = (filePath.split('/').pop() ?? '').replace(/\.[^.]+$/, '')
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .split(/[-_.]/)
    .filter((word) => word !== '' && !FILLER_WORDS.has(word))
}

/** How many of the files each word of their names is in. */
function filesPerWord(files: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const filePath of files) {
    for (const word of new Set(wordsOf(filePath))) counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return counts
}

/** The word in the most files' names, the first alphabetically on a tie. */
function mostSharedWord(counts: Map<string, number>): { word: string; fileCount: number } | null {
  const ranked = [...counts]
    .map(([word, fileCount]) => ({ word, fileCount }))
    .sort((first, second) => second.fileCount - first.fileCount || first.word.localeCompare(second.word))
  return ranked[0] ?? null
}

/** The word enough of the files share to name them (`MIN_FILES_TO_NAME_A_WORD`), or null. */
function sharedWordOf(files: string[]): string | null {
  const top = mostSharedWord(filesPerWord(files))
  return top !== null && top.fileCount >= MIN_FILES_TO_NAME_A_WORD ? top.word : null
}

/** The files a folder's story leaves after naming some by a shared word: a path for one, a count for several. */
function remainderPhrases(folder: string, files: string[], isRemainder: boolean): Phrase[] {
  if (files.length === 0) return []
  if (files.length === 1) return [{ text: files[0], files: 1 }]
  const others = isRemainder ? 'other ' : ''
  return [
    { text: `${files.length} ${others}files in ${folder === '' ? REPOSITORY_ROOT : folder}`, files: files.length },
  ]
}

/** A folder's source files: those sharing a word as "the retention modules", then the rest of the folder. */
function sourcePhrases({ folder, files }: FolderGroup): Phrase[] {
  const sharedWord = sharedWordOf(files)
  const named = sharedWord === null ? [] : files.filter((filePath) => wordsOf(filePath).includes(sharedWord))
  const rest = files.filter((filePath) => !named.includes(filePath))
  const modules = sharedWord === null ? [] : [{ text: `the ${sharedWord} modules`, files: named.length }]
  return [...modules, ...remainderPhrases(folder, rest, named.length > 0)]
}

function testPhrase(tests: string[]): Phrase[] {
  if (tests.length === 0) return []
  const folders = groupByFolder(tests).map((group) => group.folder)
  const text =
    folders.length <= MAX_TEST_FOLDERS_NAMED ? `tests in ${joinWithAnd(folders)}` : pluralize(tests.length, 'test file')
  return [{ text, files: tests.length }]
}

function docPhrase(docs: string[]): Phrase[] {
  if (docs.length === 0) return []
  return [{ text: docs.length === 1 ? docs[0] : pluralize(docs.length, 'doc'), files: docs.length }]
}

/** The first phrases as they are; everything past them folded into "N other files". */
function withinLimit(phrases: Phrase[]): string[] {
  if (phrases.length <= MAX_PHRASES) return phrases.map(({ text }) => text)
  const kept = phrases.slice(0, MAX_PHRASES - 1)
  const folded = phrases.slice(MAX_PHRASES - 1).reduce((total, { files }) => total + files, 0)
  return [...kept.map(({ text }) => text), `${folded} other files`]
}

/**
 * One line saying what these events read — plans by ticket, source by the word its files share or by folder, tests by
 * folder, docs by count — or null when none of them read anything. Reads each path once.
 */
export function describeReads(events: EventPayload[]): string | null {
  const paths = [...new Set(events.flatMap((event) => event.reads ?? []))]
  if (paths.length === 0) return null
  const kinds = paths.map((filePath) => ({ filePath, kind: kindOf(filePath) }))
  const ofKind = (kind: PathKind): string[] =>
    kinds.filter((entry) => entry.kind === kind).map((entry) => entry.filePath)
  const phrases = [
    ...planPhrase(ofKind('plan')),
    ...groupByFolder(ofKind('source')).flatMap(sourcePhrases),
    ...testPhrase(ofKind('test')),
    ...docPhrase(ofKind('doc')),
  ]
  return `Read ${joinWithAnd(withinLimit(phrases))}`
}
