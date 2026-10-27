/** The part of a SQLite connection migrations use — `node:sqlite`'s `DatabaseSync` fits, and so does a test database. */
export interface MigrationDatabase {
  exec(sql: string): void
  prepare(sql: string): {
    get(...parameters: unknown[]): unknown
    all(...parameters: unknown[]): unknown[]
    run(...parameters: unknown[]): unknown
  }
}

export interface Migration {
  version: number
  description: string
  sql: string
  /** Changes that need code, not just SQL (e.g. reclassifying stored events). Runs after `sql`, in the same transaction. */
  run?: (db: MigrationDatabase) => void
}
