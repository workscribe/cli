import type { MigrationDatabase } from '../migration-types'
import type { DataJob, JobVerification } from './types'
import { BACKUP_KEY_PREFIX, parseBackupRecord } from './backup'
import { getJobRow, getMetaValue, getMetaValuesWithPrefix, isJobDone, setMetaValue, type JobRow } from './store'

const CLI_VERSION_KEY = 'cliVersion'

export interface DataStatus {
  pending: string[]
  failed: { name: string; error: string } | null
  /** Finished jobs whose check didn't pass: their counts show data went missing. Never cleared by a rerun. */
  failedChecks: string[]
  /** Rows the finished jobs couldn't resolve, across every job (kept in `data_job_issues`). */
  unresolvedRows: number
  latestBackup: string | null
}

function readVerification(row: JobRow | null): JobVerification | null {
  if (row?.status !== 'done' || !row.verification) return null
  return JSON.parse(row.verification) as JobVerification
}

function readLatestBackup(db: MigrationDatabase): string | null {
  const paths = [...getMetaValuesWithPrefix(db, BACKUP_KEY_PREFIX).values()]
    .map(parseBackupRecord)
    .flatMap((record) => (record?.state === 'done' ? [record] : []))
    .sort((first, second) => second.at.localeCompare(first.at))
    .map((record) => record.path)
  return paths[0] ?? null
}

/** What `status` and `upgrade` say about the data jobs: pending, failed, checks that didn't pass, the last backup. */
export function readDataStatus(db: MigrationDatabase, jobs: DataJob[]): DataStatus {
  const rows = jobs.map((job) => ({ job, row: getJobRow(db, job.name) }))
  const verifications = rows.map(({ job, row }) => ({ name: job.name, verification: readVerification(row) }))
  const failedRow = rows.find(({ row }) => row?.status === 'failed')?.row
  return {
    pending: rows.filter(({ job, row }) => !isJobDone(row, job)).map(({ job }) => job.name),
    failed: failedRow ? { name: failedRow.name, error: failedRow.error ?? 'unknown error' } : null,
    failedChecks: verifications.filter(({ verification }) => verification?.hasPassed === false).map(({ name }) => name),
    unresolvedRows: verifications.reduce((total, { verification }) => total + (verification?.unresolved ?? 0), 0),
    latestBackup: readLatestBackup(db),
  }
}

/** What a command that reads data only after a job has run says while that job hasn't. */
export const UPGRADE_NEEDED_MESSAGE =
  "Workscribe hasn't finished upgrading your data — run workscribe upgrade, then try again."

/**
 * Whether every job named is in `jobs` and done. A name missing from `jobs` counts as not done, so a reader gated on
 * a job never answers before it ran.
 */
export function areJobsDone(db: MigrationDatabase, jobs: DataJob[], names: ReadonlySet<string>): boolean {
  const named = jobs.filter((job) => names.has(job.name))
  return named.length === names.size && named.every((job) => isJobDone(getJobRow(db, job.name), job))
}

/** Remembers the last CLI version that ran a data command — the upgrade signal the CLI had no record of before. */
export function recordCliVersion(db: MigrationDatabase, version: string): void {
  if (getMetaValue(db, CLI_VERSION_KEY) === version) return
  setMetaValue(db, CLI_VERSION_KEY, version)
}
