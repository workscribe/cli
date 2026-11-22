import { describe, it, expect, vi, onTestFinished } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { applyMigrations } from '../../src/db/migrate'
import { MIGRATIONS } from '../../src/db/migrations'
import { JOBS } from '../../src/db/jobs'
import { runPendingJobs } from '../../src/db/jobs/runner'
import { scrubEvent, scrubSecretsJob } from '../../src/db/jobs/scrub-secrets'
import { commandHint } from '../../src/capture/hint'
import { getJobRow, getMetaValue } from '../../src/db/jobs/store'
import { BUSY_TIMEOUT_MS } from '../../src/db/transaction'
import { dropOldSessionsJob } from '../../src/db/jobs/drop-old-sessions'

// Migration 006 normalises stored events using the user's config — keep it off the real one
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({ capture: { aiTools: true } })) }))
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))

const SECRET = 'FAKESECRETVALUE'
const REDACTED_COMMAND = 'run --password=[REDACTED]'
const COMMAND_WITH_SECRET = `run --password=${SECRET}`

interface StoredEvent {
  command: string
  metadata?: string | null
  file_path?: string | null
  category?: string
}

function database(file = ':memory:'): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON')
  applyMigrations(db, MIGRATIONS)
  return db
}

function insert(db: DatabaseSync, event: StoredEvent): number {
  const result = db
    .prepare(
      `INSERT INTO events (captured_at, command, cwd, exit_code, repo_name, branch, category, metadata, source, file_path)
       VALUES ('2026-10-28T12:00:00.000Z', ?, '/code/cli', 0, 'cli', 'main', ?, ?, 'zsh', ?)`
    )
    .run(event.command, event.category ?? 'other', event.metadata ?? null, event.file_path ?? null)
  return Number(result.lastInsertRowid)
}

function row(db: DatabaseSync, id: number): Record<string, unknown> {
  return { ...(db.prepare('SELECT * FROM events WHERE id = ?').get(id) as Record<string, unknown>) }
}

function run(db: DatabaseSync, options: { batchSize?: number; budgetMs?: number } = {}) {
  return runPendingJobs(db, [scrubSecretsJob], { ensureBackup: () => 'ready', batchSize: 2, ...options })
}

describe('scrubEvent', () => {
  it('returns null when there is nothing to remove', () => {
    expect(scrubEvent({ command: 'npm test', metadata: null })).toBeNull()
  })

  it('leaves metadata with no secret as it was written, spacing and all', () => {
    const metadata = '{ "message" :  "fix the login page",  "count": 3 }'

    expect(scrubEvent({ command: 'git push', metadata })).toBeNull()
  })

  it('redacts the command, keeping metadata that has no secret byte for byte', () => {
    const metadata = '{ "tool":  "run" }'

    expect(scrubEvent({ command: COMMAND_WITH_SECRET, metadata })).toEqual({ command: REDACTED_COMMAND, metadata })
  })

  it('redacts strings at any depth, leaving numbers, booleans and nulls alone', () => {
    const metadata = JSON.stringify({
      prompt: `use --token=${SECRET}`,
      commits: [{ subject: `set --password=${SECRET}`, count: 2 }],
      isMerged: false,
      branch: null,
    })

    const scrubbed = scrubEvent({ command: 'git push', metadata })

    expect(JSON.parse(scrubbed?.metadata as string)).toEqual({
      prompt: 'use --token=[REDACTED]',
      commits: [{ subject: 'set --password=[REDACTED]', count: 2 }],
      isMerged: false,
      branch: null,
    })
  })

  it('takes a hint again from the new command, as an old one can end midway through a secret', () => {
    const key = 'sk-ant-api03-' + 'a'.repeat(100)
    const command = `  deploy ${' '.repeat(90)}${key} --now`
    const metadata = JSON.stringify({ tool: 'deploy', hint: commandHint(command) })
    expect(metadata).toContain('sk-ant')

    const scrubbed = scrubEvent({ command, metadata })

    const { hint } = JSON.parse(scrubbed?.metadata as string) as { hint: string }
    expect(hint).toBe(commandHint(scrubbed?.command as string))
    expect(hint).toContain('[REDACTED]')
    expect(hint).not.toContain('sk-ant')
  })

  it('removes a value that only the old command held, even if it means nothing alone', () => {
    const metadata = JSON.stringify({ packages: ['FAKEVALUE', 'lodash'] })

    const scrubbed = scrubEvent({ command: 'npm install --token FAKEVALUE lodash', metadata })

    expect(scrubbed?.command).toBe('npm install --token [REDACTED] lodash')
    expect(JSON.parse(scrubbed?.metadata as string)).toEqual({ packages: ['[REDACTED]', 'lodash'] })
  })

  it('keeps a value the scrubbed command still holds, as redaction judged it in context', () => {
    const metadata = JSON.stringify({ message: 'fix redis-cli -a WOR-12 handling' })

    expect(scrubEvent({ command: 'git commit -m "fix redis-cli -a WOR-12 handling"', metadata })).toBeNull()
  })

  it('keeps such a value when something else in the command was redacted', () => {
    const metadata = JSON.stringify({ message: 'fix mongo -p flag' })

    const scrubbed = scrubEvent({ command: `git commit -m "fix mongo -p flag" --password=${SECRET}`, metadata })

    expect(scrubbed?.metadata).toBe(metadata)
  })

  it('keeps the rest of a message when only part of it was redacted', () => {
    const metadata = JSON.stringify({ message: 'WOR-12 add --pass option' })

    const scrubbed = scrubEvent({ command: 'git commit -m "WOR-12 add --pass option"', metadata })

    expect(scrubbed?.command).toBe('git commit -m "WOR-12 add --pass [REDACTED]"')
    expect(JSON.parse(scrubbed?.metadata as string)).toEqual({ message: 'WOR-12 add --pass [REDACTED]' })
  })

  it('keeps a hint when the command had no secret', () => {
    const metadata = JSON.stringify({ hint: 'a hint that was edited by hand' })

    expect(scrubEvent({ command: 'make deploy', metadata })).toBeNull()
  })

  it('redacts metadata that is not valid JSON as plain text', () => {
    const scrubbed = scrubEvent({ command: 'git push', metadata: `{broken --password=${SECRET}` })

    expect(scrubbed?.metadata).toBe('{broken --password=[REDACTED]')
  })

  it('finds nothing more to remove the second time', () => {
    const metadata = JSON.stringify({ hint: COMMAND_WITH_SECRET })
    const scrubbed = scrubEvent({ command: COMMAND_WITH_SECRET, metadata })

    expect(scrubEvent(scrubbed as { command: string; metadata: string })).toBeNull()
  })
})

describe('scrub-secrets job', () => {
  it('rewrites only the rows with a secret, and nothing else about them', () => {
    const db = database()
    const clean = insert(db, { command: 'npm test', metadata: '{ "script":  "test" }', category: 'testing' })
    const withSecret = insert(db, { command: COMMAND_WITH_SECRET, metadata: JSON.stringify({ tool: 'run' }) })
    const cleanBefore = row(db, clean)
    const secretBefore = row(db, withSecret)

    run(db)

    expect(row(db, clean)).toEqual(cleanBefore)
    expect(row(db, withSecret)).toEqual({ ...secretBefore, command: REDACTED_COMMAND })
  })

  it('scrubs a credential assigned in code, in a command and in a note', () => {
    const db = database()
    const command = insert(db, { command: `node -e "const API_KEY = '${SECRET}1234'"` })
    const note = insert(db, {
      command: 'workscribe note',
      metadata: JSON.stringify({ text: `tried token = '${SECRET}1234' in a script` }),
      category: 'note',
    })

    run(db)

    expect(row(db, command).command).toBe(`node -e "const API_KEY = '[REDACTED]'"`)
    expect(row(db, note).metadata).toBe(JSON.stringify({ text: `tried token = '[REDACTED]' in a script` }))
  })

  it('scrubs a form that redaction learned after the command was stored', () => {
    const db = database()
    const stored = insert(db, { command: `7z a -p${SECRET} out.7z dir` })

    run(db)

    expect(row(db, stored).command).toBe('7z a -p[REDACTED] out.7z dir')
  })

  describe('an infrastructure form redaction learned in WOR-191', () => {
    const terraform = `terraform apply -var 'token=${SECRET}'`
    const redactedTerraform = "terraform apply -var 'token=[REDACTED]'"

    it('is scrubbed from a stored command', () => {
      const db = database()
      const stored = insert(db, { command: terraform })

      run(db)

      expect(row(db, stored).command).toBe(redactedTerraform)
    })

    it('is scrubbed from the hint kept beside the command', () => {
      const db = database()
      const stored = insert(db, { command: terraform, metadata: JSON.stringify({ hint: terraform }) })

      run(db)

      expect(row(db, stored).metadata).toBe(JSON.stringify({ hint: redactedTerraform }))
    })

    it('is scrubbed from a note', () => {
      const db = database()
      const stored = insert(db, {
        command: 'workscribe note',
        metadata: JSON.stringify({ text: `ran ${terraform}` }),
        category: 'note',
      })

      run(db)

      expect(row(db, stored).metadata).toBe(JSON.stringify({ text: `ran ${redactedTerraform}` }))
    })
  })

  describe('a secret a command wrote as plain text, learned in WOR-204', () => {
    const written = `echo "password: ${SECRET}" > values.yaml`
    const redactedWritten = 'echo "password: [REDACTED]" > values.yaml'

    it('is scrubbed from a stored command and from the hint beside it', () => {
      const db = database()
      const stored = insert(db, { command: written, metadata: JSON.stringify({ hint: written }) })

      run(db)

      expect(row(db, stored).command).toBe(redactedWritten)
      expect(row(db, stored).metadata).toBe(JSON.stringify({ hint: redactedWritten }))
    })

    it('is scrubbed when it is a bare secret written to a file named for it', () => {
      const db = database()
      const stored = insert(db, { command: `echo ${SECRET} > ~/.vault-pass` })

      run(db)

      expect(row(db, stored).command).toBe('echo [REDACTED] > ~/.vault-pass')
    })
  })

  it('runs again over a database where an older version of the job was done', () => {
    const db = database()
    db.prepare(
      `INSERT INTO data_jobs (name, version, cursor, status, started_at)
       VALUES (?, ?, 0, 'done', '2026-11-19T12:00:00.000Z')`
    ).run(scrubSecretsJob.name, scrubSecretsJob.version - 1)
    const stored = insert(db, { command: `vault login s.${SECRET}` })
    const written = insert(db, { command: `echo "password: ${SECRET}" > values.yaml` })

    run(db)

    expect(row(db, stored).command).toBe('vault login [REDACTED]')
    expect(row(db, written).command).toBe('echo "password: [REDACTED]" > values.yaml')
  })

  it('scrubs a note, and a command from an IDE even when it names a file', () => {
    const db = database()
    const note = insert(db, {
      command: 'workscribe note',
      metadata: JSON.stringify({ text: `rotated --token=${SECRET}` }),
      category: 'note',
    })
    const ideCommand = insert(db, { command: COMMAND_WITH_SECRET, file_path: '/code/cli/a.ts', category: 'task_run' })

    run(db)

    expect(row(db, note).metadata).toBe(JSON.stringify({ text: 'rotated --token=[REDACTED]' }))
    expect(row(db, ideCommand).command).toBe(REDACTED_COMMAND)
    expect(row(db, ideCommand).file_path).toBe('/code/cli/a.ts')
  })

  it('leaves an IDE save alone, even when its path looks like a secret', () => {
    const db = database()
    const filePath = `/code/cli/--password=${SECRET}`
    const save = insert(db, { command: filePath, file_path: filePath, category: 'code_edit' })
    const before = row(db, save)

    const result = run(db)

    expect(row(db, save)).toEqual(before)
    expect(result.jobs[0].verification?.unresolved).toBe(0)
  })

  it('gives the same result stopped after every batch and resumed', () => {
    const db = database()
    const ids = [0, 1, 2, 3, 4].map((index) => insert(db, { command: `run --password=${SECRET}${index}` }))

    const first = run(db, { batchSize: 1, budgetMs: 0 })
    expect(first.jobs[0].outcome).toBe('paused')
    expect(row(db, ids[4]).command).toContain(SECRET)
    for (let attempt = 0; attempt < ids.length + 1; attempt++) run(db, { batchSize: 1, budgetMs: 0 })

    expect(getJobRow(db, scrubSecretsJob.name)?.status).toBe('done')
    for (const id of ids) expect(row(db, id).command).toBe(REDACTED_COMMAND)
  })

  it('reports the counts, and no text from the events', () => {
    const db = database()
    insert(db, { command: 'npm test' })
    insert(db, { command: COMMAND_WITH_SECRET })

    const { verification } = run(db).jobs[0]

    expect(verification).toMatchObject({ checked: 2, resolved: 2, unresolved: 0, hasPassed: true, notes: [] })
    expect(JSON.stringify(verification)).not.toContain(SECRET)
  })

  it('counts a row that would still change, without failing the check or naming its text', () => {
    const db = database()
    insert(db, { command: COMMAND_WITH_SECRET })

    const verification = scrubSecretsJob.verify(db)

    expect(verification).toMatchObject({ checked: 1, resolved: 0, unresolved: 1, hasPassed: true })
    expect(verification.notes).toEqual(['events that would still change: 1'])
    expect(JSON.stringify(verification)).not.toContain(SECRET)
  })

  it('puts the lock wait back after cleaning up the file', () => {
    const db = database()
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)
    insert(db, { command: COMMAND_WITH_SECRET })

    run(db)

    expect({ ...(db.prepare('PRAGMA busy_timeout').get() as object) }).toEqual({ timeout: BUSY_TIMEOUT_MS })
  })

  it('runs ahead of drop-old-sessions, and on a database where that job is already done', () => {
    const names = JOBS.map((job) => job.name)
    expect(names.indexOf(scrubSecretsJob.name)).toBeLessThan(names.indexOf(dropOldSessionsJob.name))

    const db = database()
    db.prepare(
      `INSERT INTO data_jobs (name, version, cursor, status, started_at)
       VALUES (?, ?, 0, 'done', '2026-10-28T12:00:00.000Z')`
    ).run(dropOldSessionsJob.name, dropOldSessionsJob.version)
    const event = insert(db, { command: COMMAND_WITH_SECRET })

    const result = runPendingJobs(db, [scrubSecretsJob, dropOldSessionsJob], { ensureBackup: () => 'ready' })

    expect(result.jobs.map((job) => job.name)).toEqual([scrubSecretsJob.name])
    expect(row(db, event).command).toBe(REDACTED_COMMAND)
  })
})

describe('scrub-secrets job — the database file itself', () => {
  const MANY_EVENTS = 5000

  function walDatabase(): { db: DatabaseSync; file: string } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-scrub-'))
    const file = path.join(directory, 'workscribe.db')
    onTestFinished(() => fs.rmSync(directory, { recursive: true, force: true }))
    const db = database(file)
    db.exec('PRAGMA journal_mode = WAL')
    return { db, file }
  }

  /** Enough rows for pages to split, which leaves old copies in unused space, plus one long enough for overflow pages. */
  function storeSecrets(db: DatabaseSync): void {
    for (let index = 0; index < MANY_EVENTS; index++) {
      insert(db, { command: COMMAND_WITH_SECRET, metadata: JSON.stringify({ prompt: COMMAND_WITH_SECRET }) })
    }
    insert(db, { command: `run ${'--flag '.repeat(2000)} --password=${SECRET}` })
    db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()
  }

  function holdsSecret(file: string): boolean {
    return [file, `${file}-wal`].some((candidate) => {
      return fs.existsSync(candidate) && fs.readFileSync(candidate).includes(SECRET)
    })
  }

  it('leaves the old text in the file when rows are rewritten without the cleanup, so this test proves something', () => {
    const { db, file } = walDatabase()
    storeSecrets(db)
    expect(holdsSecret(file)).toBe(true)

    db.exec("UPDATE events SET command = 'run --password=[REDACTED]'")
    db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get()

    expect(holdsSecret(file)).toBe(true)
    db.close()
  })

  it('removes the old text from the file, before the connection closes', () => {
    const { db, file } = walDatabase()
    storeSecrets(db)

    run(db, { batchSize: 500 })

    expect(holdsSecret(file)).toBe(false)
    db.close()
  })

  it('tries again on a later run when a reader holds the file back, without rewriting it twice', () => {
    const { db, file } = walDatabase()
    storeSecrets(db)
    const reader = new DatabaseSync(file)
    reader.exec('BEGIN')
    reader.prepare('SELECT COUNT(*) FROM events').get()

    run(db, { batchSize: 500 })
    expect(getMetaValue(db, 'scrub-secrets:file-cleanup')).not.toBeNull()

    reader.exec('COMMIT')
    reader.close()
    run(db)

    expect(getMetaValue(db, 'scrub-secrets:file-cleanup')).toBeNull()
    expect(holdsSecret(file)).toBe(false)
    db.close()
  })
})

describe('agent recaps', () => {
  const insertAgentSession = (db: DatabaseSync, recap: string | null, compactSummary: string | null) =>
    db
      .prepare(
        `INSERT INTO agent_sessions (source, session_id, cwd, started_at, last_seen_at, recap, compact_summary)
         VALUES ('claude-code', ?, '/code/cli', '2026-10-28T12:00:00.000Z', '2026-10-28T12:00:00.000Z', ?, ?)`
      )
      .run(`conversation-${Math.random()}`, recap, compactSummary)
  const messages = (db: DatabaseSync) =>
    db.prepare('SELECT recap, compact_summary AS compactSummary FROM agent_sessions ORDER BY id').all()

  it('drops a stored recap or compaction summary the secret check flags, keeping the other', () => {
    const db = database()
    insertAgentSession(db, `Ran it with --password=${SECRET}`, 'A summary with nothing to hide')
    insertAgentSession(db, null, 'Used key AKIAIOSFODNN7EXAMPLE to deploy')

    run(db)

    expect(messages(db)).toEqual([
      { recap: null, compactSummary: 'A summary with nothing to hide' },
      { recap: null, compactSummary: null },
    ])
  })

  it('leaves a recap with nothing to remove as it is', () => {
    const db = database()
    insertAgentSession(db, 'Added branch-move reading to summaries.', null)

    run(db)

    expect(messages(db)).toEqual([{ recap: 'Added branch-move reading to summaries.', compactSummary: null }])
  })
})
