import initialSchema from './001_initial_schema'
import semanticCategories from './002_semantic_categories'
import alerts from './003_alerts'
import ideColumns from './004_ide_columns'

export interface Migration {
  version: number
  description: string
  sql: string
}

// Ordered list — append only. Never modify or remove an existing entry.
export const MIGRATIONS: Migration[] = [initialSchema, semanticCategories, alerts, ideColumns]
