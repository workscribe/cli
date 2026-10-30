import type { MigrationDatabase } from '../migration-types'
import type { DataJob, JobIssue, JobVerification } from './types'

export type JobStatus = 'pending' | 'running' | 'done' | 'failed'

export interface JobRow {
  name: string
  version: number
  cursor: number
  status: JobStatus
  started_at: string | null
  finished_at: string | null
  verification: string | null
  error: string | null
}

export function getMetaValue(db: MigrationDatabase, key: string): string | null {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setMetaValue(db: MigrationDatabase, key: string, value: string): void {
  db.prepare(
    'INSERT INTO meta (key, value) VALUES ($key, $value) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
  ).run({ key, value })
}

export function deleteMetaValue(db: MigrationDatabase, key: string): void {
  db.prepare('DELETE FROM meta WHERE key = ?').run(key)
}

/** Meta values whose key starts with `prefix`, keyed by the rest of the key. */
export function getMetaValuesWithPrefix(db: MigrationDatabase, prefix: string): Map<string, string> {
  const rows = db
    .prepare("SELECT key, value FROM meta WHERE key LIKE ? ESCAPE '\\'")
    .all(`${prefix.replace(/[\\%_]/g, '\\$&')}%`) as { key: string; value: string }[]
  return new Map(rows.map((row) => [row.key.slice(prefix.length), row.value]))
}

export function getJobRow(db: MigrationDatabase, name: string): JobRow | null {
  return (db.prepare('SELECT * FROM data_jobs WHERE name = ?').get(name) as JobRow | undefined) ?? null
}

/** Done at this version or a later one — a later version means a newer CLI already ran it; never run it backwards. */
export function isJobDone(row: JobRow | null, job: DataJob): boolean {
  return row !== null && row.status === 'done' && row.version >= job.version
}

/** Starts the job, or restarts it from scratch when its version moved on since it last ran. */
export function startJob(db: MigrationDatabase, job: DataJob, startedAt: string): void {
  const row = getJobRow(db, job.name)
  if (row !== null && row.version >= job.version) {
    db.prepare("UPDATE data_jobs SET status = 'running', error = NULL WHERE name = ?").run(job.name)
    return
  }
  job.prepare(db)
  db.prepare(
    `INSERT INTO data_jobs (name, version, cursor, status, started_at)
     VALUES ($name, $version, 0, 'running', $started_at)
     ON CONFLICT (name) DO UPDATE SET version = excluded.version, cursor = 0, status = 'running',
       started_at = excluded.started_at, finished_at = NULL, verification = NULL, error = NULL`
  ).run({ name: job.name, version: job.version, started_at: startedAt })
}

export function setJobCursor(db: MigrationDatabase, name: string, cursor: number): void {
  db.prepare('UPDATE data_jobs SET cursor = $cursor WHERE name = $name').run({ name, cursor })
}

export function recordJobIssues(db: MigrationDatabase, job: DataJob, issues: JobIssue[], recordedAt: string): void {
  const insert = db.prepare(
    `INSERT INTO data_job_issues (job_name, job_version, reference, reason, recorded_at)
     VALUES ($job_name, $job_version, $reference, $reason, $recorded_at)`
  )
  for (const issue of issues) {
    insert.run({
      job_name: job.name,
      job_version: job.version,
      reference: issue.reference,
      reason: issue.reason,
      recorded_at: recordedAt,
    })
  }
}

/**
 * Marks the job done — only at this job's version. Returns false when the row moved on to another version meanwhile
 * (a newer CLI restarted it), so older code never marks newer work done.
 */
export function finishJob(
  db: MigrationDatabase,
  job: DataJob,
  verification: JobVerification,
  finishedAt: string
): boolean {
  const result = db
    .prepare(
      `UPDATE data_jobs SET status = 'done', finished_at = $finished_at, verification = $verification
       WHERE name = $name AND version = $version`
    )
    .run({ name: job.name, version: job.version, finished_at: finishedAt, verification: JSON.stringify(verification) })
  return (result as { changes: number | bigint }).changes > 0
}

/** Records the failure, creating the job's row if it failed before its first write (say, in `prepare`). */
export function failJob(db: MigrationDatabase, job: DataJob, error: string): void {
  db.prepare(
    `INSERT INTO data_jobs (name, version, status, error) VALUES ($name, $version, 'failed', $error)
     ON CONFLICT (name) DO UPDATE SET status = 'failed', error = excluded.error`
  ).run({ name: job.name, version: job.version, error })
}
