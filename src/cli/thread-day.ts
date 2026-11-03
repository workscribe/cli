// The day's threads as `sessions` and `sessions summary set` read them. They never run data jobs (the agent skill
// calls them), and there's no older path to fall back to: until the thread jobs have run, threads would put old
// events "elsewhere" and `context` couldn't show a summary saved for one, so the commands ask for
// `workscribe upgrade` instead. The gate is the one `context` uses.
import { getDb } from '../db'
import { JOBS } from '../db/jobs'
import { UPGRADE_NEEDED_MESSAGE } from '../db/jobs/state'
import { isReadyForThreads, readDayThreads, type DayBlock } from '../db/day-threads'
import { ensureDayThreads } from '../sessions/threads'
import { fail } from './fail'

/** Exits with the upgrade message unless threads can be read yet. */
export function requireThreadData(): void {
  if (!isReadyForThreads(getDb(), JOBS)) fail(UPGRADE_NEEDED_MESSAGE)
}

/** The day's blocks and threads, built first if the day changed since they were. */
export function loadDayThreads(date: string): DayBlock[] {
  ensureDayThreads(date)
  return readDayThreads(getDb(), date)
}
