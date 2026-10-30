import path from 'path'
import type { MigrationDatabase } from '../migration-types'
import type { DirectoryProbe } from '../../capture/git'
import { withImmediateTransaction, withReadTransaction } from '../transaction'
import { rootForms } from '../../utils/working-directory'

// `directory_probe`: what git said about each folder stored events mention, asked once and kept, so a job that
// reruns gets the same answer without asking again.

interface ProbeRow {
  path: string
  outcome: DirectoryProbe['outcome']
  root: string | null
  common_dir: string | null
  remote_url: string | null
}

function toProbe(row: ProbeRow): DirectoryProbe {
  if (row.outcome !== 'repo' || row.root === null) {
    return { outcome: row.outcome === 'missing' ? 'missing' : 'not-a-repo' }
  }
  return { outcome: 'repo', root: row.root, commonDir: row.common_dir, remoteUrl: row.remote_url }
}

export function loadProbes(db: MigrationDatabase): Map<string, DirectoryProbe> {
  const rows = db.prepare('SELECT * FROM directory_probe').all() as ProbeRow[]
  return new Map(rows.map((row) => [row.path, toProbe(row)]))
}

/** Every folder an event was captured in or saved a file in that git hasn't been asked about yet. */
export function foldersToProbe(db: MigrationDatabase): string[] {
  return withReadTransaction(db, () => {
    const probed = new Set(loadProbes(db).keys())
    const cwds = db.prepare('SELECT DISTINCT cwd FROM events').all() as { cwd: string }[]
    const files = db.prepare('SELECT DISTINCT file_path FROM events WHERE file_path IS NOT NULL').all() as {
      file_path: string
    }[]
    const folders = new Set([...cwds.map((row) => row.cwd), ...files.map((row) => path.dirname(row.file_path))])
    return [...folders].filter((folder) => !probed.has(folder)).sort()
  })
}

/**
 * Stores the probe in a transaction of its own, with the root as the folder reaches it — the form stored `cwd`s and
 * file paths use. The remote comes without credentials (`probeDirectory` strips them).
 */
export function saveProbe(db: MigrationDatabase, folder: string, probe: DirectoryProbe): void {
  const isRepo = probe.outcome === 'repo'
  const root = isRepo ? (rootForms(folder, probe.root).at(-1) ?? probe.root) : null
  withImmediateTransaction(db, () =>
    db
      .prepare(
        `INSERT OR REPLACE INTO directory_probe (path, outcome, root, common_dir, remote_url)
         VALUES ($path, $outcome, $root, $common_dir, $remote_url)`
      )
      .run({
        path: folder,
        outcome: probe.outcome,
        root,
        common_dir: isRepo ? probe.commonDir : null,
        remote_url: isRepo ? probe.remoteUrl : null,
      })
  )
}
