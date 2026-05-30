/**
 * Thin adapter that normalises node:sqlite (Node 22.5+) and better-sqlite3 (Node 20+)
 * behind one interface. Both expose the same synchronous API so no method-level
 * translation is required — we only need to pick the right constructor.
 */

export interface DbStatement {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  run(...args: any[]): { lastInsertRowid: bigint | number; changes: number }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get(...args: any[]): unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  all(...args: any[]): unknown[]
}

export interface DbAdapter {
  exec(sql: string): void
  prepare(sql: string): DbStatement
}

export function openDatabase(path: string): DbAdapter {
  // Prefer the built-in driver on Node 22.5+
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => DbAdapter }
    return new DatabaseSync(path)
  } catch {
    /* node:sqlite unavailable — try the optional peer dependency */
  }

  // Fallback: better-sqlite3 (must be installed by the user on Node 20–21)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Database = require('better-sqlite3') as new (path: string) => DbAdapter
    return new Database(path)
  } catch {
    /* neither driver available */
  }

  throw new Error(
    'workscribe requires a SQLite driver.\n' +
      '  Node 22.5+: node:sqlite is used automatically (no action needed).\n' +
      '  Node 20–21: install the optional peer dependency:\n' +
      '    npm install better-sqlite3'
  )
}
