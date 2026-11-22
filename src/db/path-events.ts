import type { MigrationDatabase } from './migration-types'

// How much is already stored for a folder — what `workscribe exclude` says it keeps. `node:sqlite`-free, so tests run
// it on an in-memory database.

/**
 * The events recorded in the folder, below it, or editing a file under it. Whole segments only, and compared with
 * `substr` rather than `LIKE`, so a `_` or `%` in a folder name means itself.
 */
export function countEventsUnderFolder(db: MigrationDatabase, folder: string): number {
  const prefix = folder.endsWith('/') ? folder : `${folder}/`
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count FROM events
       WHERE cwd = $folder OR substr(cwd, 1, length($prefix)) = $prefix
          OR file_path = $folder OR substr(file_path, 1, length($prefix)) = $prefix`
    )
    .get({ folder, prefix }) as { count: number }
  return row.count
}
