import initialSchema from './001_initial_schema'
import semanticCategories from './002_semantic_categories'
import alerts from './003_alerts'
import ideColumns from './004_ide_columns'
import sessionSummaries from './005_session_summaries'
import reclassifyOther from './006_reclassify_other'
import type { Migration } from '../migration-types'

export type { Migration } from '../migration-types'

// Ordered list — append only. Never modify or remove an existing entry.
export const MIGRATIONS: Migration[] = [
  initialSchema,
  semanticCategories,
  alerts,
  ideColumns,
  sessionSummaries,
  reclassifyOther,
]
