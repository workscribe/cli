// What a day's `exploring` rows read, for the story's Read line. Pure: the caller says where each folder's repository is
// and which paths git ignores (`src/summary/read-resolver.ts`), so this never touches git or the file system.
import { readPathsOf } from '../normalize/read-paths'
import type { EventRow } from '../db/types'

const READING_CATEGORY = 'exploring'

/** What the summary needs to know about the machine to name what was read. */
export interface ReadPathResolver {
  /** The repository a folder is in, or null when it isn't in one or can't be found (a folder that is gone). */
  repoRootOf(cwd: string): string | null
  /** The paths among these that git ignores, or null when git couldn't say. */
  ignoredAmong(repoRoot: string, paths: string[]): Set<string> | null
}

interface RowReads {
  index: number
  repoRoot: string
  paths: string[]
}

function candidatesOf(rows: EventRow[], resolver: ReadPathResolver): RowReads[] {
  return rows.flatMap((row, index) => {
    if (row.category !== READING_CATEGORY) return []
    const repoRoot = resolver.repoRootOf(row.cwd)
    if (repoRoot === null) return []
    const paths = readPathsOf(row.command, { cwd: row.cwd, repoRoot })
    return paths.length > 0 ? [{ index, repoRoot, paths }] : []
  })
}

/** The paths of each repository's rows that git doesn't ignore; a repository git can't answer for has none. */
function allowedPathsByRepository(candidates: RowReads[], resolver: ReadPathResolver): Map<string, Set<string>> {
  const allowed = new Map<string, Set<string>>()
  for (const repoRoot of new Set(candidates.map((candidate) => candidate.repoRoot))) {
    const ofRepository = candidates.filter((candidate) => candidate.repoRoot === repoRoot)
    const repositoryPaths = [...new Set(ofRepository.flatMap((candidate) => candidate.paths))]
    const ignored = resolver.ignoredAmong(repoRoot, repositoryPaths)
    if (ignored !== null) {
      allowed.set(repoRoot, new Set(repositoryPaths.filter((filePath) => !ignored.has(filePath))))
    }
  }
  return allowed
}

/**
 * The files and folders each `exploring` row read, by the row's position, leaving out what git ignores. A row with no
 * repository, or in one git can't check, is left out whole: when it can't be said what is ignored, nothing is named.
 */
export function readsOfRows(rows: EventRow[], resolver: ReadPathResolver): Map<number, string[]> {
  const candidates = candidatesOf(rows, resolver)
  const allowed = allowedPathsByRepository(candidates, resolver)
  const reads = new Map<number, string[]>()
  for (const { index, repoRoot, paths } of candidates) {
    const kept = paths.filter((filePath) => allowed.get(repoRoot)?.has(filePath))
    if (kept.length > 0) reads.set(index, kept)
  }
  return reads
}
