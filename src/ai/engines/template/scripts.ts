// What the story says of scripts it can't see into: a script read from standard input (`python3 - <<EOF`) has its body
// removed before the command is stored, so nothing shows what it did to the files. Pure.
import { pluralize } from './utils'
import type { EventPayload } from '../../types'
import type { StoryCommit } from '../../../summary/story-commits'

/** The latest commit time among the commits that have one, or null when none does. */
function latestCommitTime(commits: StoryCommit[]): number | null {
  const times = commits.flatMap((commit) => (commit.committedAt === null ? [] : [Date.parse(commit.committedAt)]))
  return times.length > 0 ? Math.max(...times) : null
}

/**
 * "Ran 3 scripts that may have changed files (contents not captured)" for the scripts these events ran after the last
 * commit — a commit's own size tells what the earlier ones changed — or all of them when no commit has a time to compare
 * with. Reads every event, whatever category it was filed under. Null when there are none: it never says a script
 * changed anything, or who did.
 */
export function describeScripts(events: EventPayload[], commits: StoryCommit[]): string | null {
  const cutoff = latestCommitTime(commits)
  const count = events.reduce((total, event) => {
    const isCovered = cutoff !== null && Date.parse(event.capturedAt) <= cutoff
    return isCovered ? total : total + (event.scripts ?? 0)
  }, 0)
  return count > 0 ? `Ran ${pluralize(count, 'script')} that may have changed files (contents not captured)` : null
}
