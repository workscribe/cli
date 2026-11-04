import type { DataJob } from './types'
import { createProjectDimensionsJob } from './project-dimensions'
import { probeDirectory } from '../../capture/git'
import { summaryAnchorsJob } from './summary-anchors'
import { dropOldSessionsJob } from './drop-old-sessions'

// Ordered list — append only. Jobs run in this order and a job only starts once every job before it is done, so a
// later job can rely on an earlier one. To change what a job does for rows it already handled, bump its version:
// the runner calls its `prepare` and runs it again over every row. Never bump `summary-anchors`: it reads the old
// session tables, which `drop-old-sessions` removes once it has run. Append new jobs before `drop-old-sessions`, not
// after: in the stuck state it accepts (a failed `summary-anchors` check) it fails on every run, and the runner never
// starts a job after a failed one.
export const JOBS: DataJob[] = [createProjectDimensionsJob({ probeDirectory }), summaryAnchorsJob, dropOldSessionsJob]
