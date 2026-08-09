import initialSchema from './001_initial_schema'

export interface Migration {
  version: number
  description: string
  sql: string
}

// Ordered list — append only. Never modify or remove an existing entry.
export const MIGRATIONS: Migration[] = [initialSchema]
