import initialSchema from './001_initial_schema'
import semanticCategories from './002_semantic_categories'
import alerts from './003_alerts'
import ideColumns from './004_ide_columns'
import sessionSummaries from './005_session_summaries'
import reclassifyOther from './006_reclassify_other'
import dataJobs from './007_data_jobs'
import dimensions from './008_dimensions'
import workBlocks from './009_work_blocks'
import summaries from './010_summaries'
import eventsProjectTime from './011_events_project_time'
import agentSessions from './012_agent_sessions'
import tickets from './013_tickets'
import agentSessionEndings from './014_agent_session_endings'
import summaryDay from './015_summary_day'
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
  dataJobs,
  dimensions,
  workBlocks,
  summaries,
  eventsProjectTime,
  agentSessions,
  tickets,
  agentSessionEndings,
  summaryDay,
]
