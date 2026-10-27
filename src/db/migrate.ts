import type { Migration, MigrationDatabase } from './migration-types'

/** An install from before the migration system already has the events table — record version 1 as applied. */
function seedVersionOneForOldInstalls(db: MigrationDatabase): void {
  const hasEvents = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='events'").get()
  const hasVersion1 = db.prepare('SELECT version FROM schema_migrations WHERE version = 1').get()
  if (hasEvents && !hasVersion1) {
    db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES ($version, datetime('now'))").run({
      version: 1,
    })
  }
}

function isApplied(db: MigrationDatabase, version: number): boolean {
  return db.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(version) !== undefined
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Applies each pending migration in order, each in its own transaction, so a failure leaves the database at
 * the previous version and the next run retries it. `BEGIN IMMEDIATE` takes the write lock up front and the
 * version is checked inside the transaction, so two processes starting at once (parallel captures from an
 * agent) can't both run a migration. Kept free of `node:sqlite` so tests can run it on any database.
 */
export function applyMigrations(db: MigrationDatabase, migrations: Migration[]): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      applied_at TEXT    NOT NULL DEFAULT (datetime('now'))
    )
  `)
  seedVersionOneForOldInstalls(db)

  for (const migration of migrations) {
    if (isApplied(db, migration.version)) continue

    db.exec('BEGIN IMMEDIATE')
    try {
      if (isApplied(db, migration.version)) {
        db.exec('COMMIT')
        continue
      }
      if (migration.sql.trim()) db.exec(migration.sql)
      migration.run?.(db)
      db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES ($version, datetime('now'))").run({
        version: migration.version,
      })
      db.exec('COMMIT')
    } catch (error) {
      try {
        db.exec('ROLLBACK')
      } catch {
        /* already rolled back or connection lost */
      }
      throw new Error(`Migration ${migration.version} (${migration.description}) failed: ${errorMessage(error)}`, {
        cause: error,
      })
    }
  }
}
