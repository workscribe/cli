import type { DataJob } from './types'
import { createProjectDimensionsJob } from './project-dimensions'
import { probeDirectory } from '../../capture/git'
import { summaryAnchorsJob } from './summary-anchors'

// Ordered list — append only. Jobs run in this order and a job only starts once every job before it is done, so a
// later job can rely on an earlier one. To change what a job does for rows it already handled, bump its version:
// the runner calls its `prepare` and runs it again over every row.
export const JOBS: DataJob[] = [createProjectDimensionsJob({ probeDirectory }), summaryAnchorsJob]
