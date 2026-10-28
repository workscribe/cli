import type { MigrationDatabase } from './migration-types'
import type { SessionRow } from './types'

/** Which sessions belong to a repo — see `findRecentSessionsForRepo`. */
export interface RepoLookup {
  /** The name the current config gives the repo */
  repoName: string
  /** The repo's name in the other `git.qualifyRepoName` form, if it has one (only names from the remote do) */
  otherRepoName: string | null
  /** The repo's working tree, in each form a stored `cwd` may use; sessions under `otherRepoName` need activity in it */
  roots: string[]
}

// A session stored under the other name form counts only if one of its events ran in this repo's working tree, so
// a same-named repo from another owner (the collision `qualifyRepoName` exists for) is never matched. `substr`
// rather than LIKE, so `%` and `_` in a path aren't wildcards. The root comes in more than one form (resolved, and
// through a symlink), passed as a JSON array.
const RECENT_SESSIONS_FOR_REPO = `
  SELECT s.* FROM sessions s
  WHERE s.repo_name = $repo_name
     OR (s.repo_name = $other_repo_name AND EXISTS (
          SELECT 1 FROM session_events se
          INNER JOIN events e ON e.id = se.event_id
          INNER JOIN json_each($roots) root
          WHERE se.session_id = s.id
            AND (e.cwd = root.value OR substr(e.cwd, 1, length(root.value) + 1) = root.value || '/')
        ))
  ORDER BY s.started_at DESC
  LIMIT $limit`

/** The repo's latest sessions, newest first, under its configured name or — inside its own tree — the other form. */
export function findRecentSessionsForRepo(db: MigrationDatabase, lookup: RepoLookup, limit: number): SessionRow[] {
  return db.prepare(RECENT_SESSIONS_FOR_REPO).all({
    repo_name: lookup.repoName,
    other_repo_name: lookup.otherRepoName,
    roots: JSON.stringify(lookup.roots),
    limit,
  }) as SessionRow[]
}
