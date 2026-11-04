// A day's summary, the way `summary` and `export` both tell it: a section per project thread — a saved summary where
// the agent skill (or a 1.x AI provider) wrote one for it, and the template's story for the rest, with the day's git
// commits looked up just for those — each followed by the projects worked alongside it, then the day's time worked.
import { DAY_GIT_BUDGET_MS, lookupDayCommits } from './day-commits'
import { locationContextFrom, threadRepoCwd, threadToPayload } from './payload'
import { pickSavedSummary, type SavedSummary } from './store'
import { summariesOfThread, type BlockEvent } from './anchors'
import { toActiveMinutes } from '../sessions/blocks'
import { formatDuration } from '../utils/format'
import type { AIProvider, SessionPayload } from '../ai/types'
import type { WorkscribeConfig } from '../config'
import type { DayBlock, DayThread } from '../db/day-threads'
import type { GitCommit } from './git-commits'

const ALONGSIDE_LABEL = 'Alongside:'
const TIME_WORKED_LABEL = 'Time worked:'

export interface RenderDayOptions {
  date: string
  /** The day's blocks and threads, as `loadDayThreads` reads them */
  blocks: DayBlock[]
  config: WorkscribeConfig
  /** What writes the summaries the skill didn't (the template) */
  provider: AIProvider
  /** Ignore saved summaries and tell every thread with the template */
  fresh?: boolean
}

export interface RenderedDay {
  /** Per thread, in block order */
  sessionPayloads: SessionPayload[]
  /** Per thread: the saved summary shown, or null where the template told it */
  saved: (SavedSummary | null)[]
  /** Per thread: its finished text, heading included */
  summaries: string[]
  /** Every thread's text with the projects alongside it, separated by a blank line, then the day's time worked */
  fullSummary: string
  /** Whether the template told any thread — the left-out events footer only applies then */
  needsGeneration: boolean
  /** Time worked: the blocks' active minutes — never the sum of the threads' */
  activeMinutes: number
}

/** The block's events in grouping order, each with its thread — what `findSummaryThread` reads. */
function blockEventsOf(block: DayBlock): BlockEvent[] {
  return block.threads
    .flatMap((thread) => thread.events.map((event) => ({ event, threadId: thread.id })))
    .sort(
      (first, second) =>
        first.event.captured_at.localeCompare(second.event.captured_at) || first.event.id - second.event.id
    )
    .map(({ event, threadId }) => ({ id: event.id, threadId }))
}

/** Each thread's best summary stored in `summary`, in block order. */
function savedSummariesOf(blocks: DayBlock[]): (SavedSummary | null)[] {
  return blocks.flatMap((block) => {
    const attachable = { threads: block.threads, events: blockEventsOf(block) }
    return block.threads.map((thread) => pickSavedSummary(summariesOfThread(thread.id, attachable, block.summaries)))
  })
}

/** git's commits for the threads the template tells, within one budget for the run; null for the others. */
function gitCommitsFor(threads: DayThread[], saved: (SavedSummary | null)[]): (GitCommit[] | null)[] {
  const toRender = threads.filter((_thread, index) => saved[index] === null)
  const windows = toRender.map((thread) => ({
    cwd: threadRepoCwd(thread.events),
    startedAt: thread.startedAt,
    endedAt: thread.endedAt,
  }))
  const commits = lookupDayCommits(windows, { budgetMs: DAY_GIT_BUDGET_MS })
  const commitsByThread = new Map(toRender.map((thread, index) => [thread, commits[index]]))
  return threads.map((thread) => commitsByThread.get(thread) ?? null)
}

function withAlongside(text: string, alongside: string[] = []): string {
  return alongside.length === 0 ? text : `${text}\n${ALONGSIDE_LABEL} ${alongside.join(', ')}`
}

function joinDay(summaries: string[], sessionPayloads: SessionPayload[], activeMinutes: number): string {
  const sections = summaries.map((text, index) => withAlongside(text, sessionPayloads[index].alongside))
  return [...sections, `${TIME_WORKED_LABEL} ${formatDuration(activeMinutes)}`].join('\n\n')
}

/** Each thread's summary for the day. Throws when the writer fails, so the command can say so and stop. */
export async function renderDay({
  date,
  blocks,
  config,
  provider,
  fresh = false,
}: RenderDayOptions): Promise<RenderedDay> {
  const threads = blocks.flatMap((block) => block.threads.map((thread) => ({ thread, block })))
  const saved = fresh ? threads.map(() => null) : savedSummariesOf(blocks)
  const gitCommits = gitCommitsFor(
    threads.map(({ thread }) => thread),
    saved
  )
  const context = locationContextFrom(config)
  const sessionPayloads = threads.map(({ thread, block }, index) =>
    threadToPayload(thread, block, { context, gitCommits: gitCommits[index] })
  )

  const summaries: string[] = []
  for (const [index, sessionPayload] of sessionPayloads.entries()) {
    const savedSummary = saved[index]
    // The writer returns the thread's finished story, heading included
    summaries.push(
      savedSummary ? savedSummary.text : (await provider.summarize({ date, sessions: [sessionPayload] })).trim()
    )
  }
  const activeMinutes = blocks.reduce((total, block) => total + toActiveMinutes(block.activeSlots), 0)
  return {
    sessionPayloads,
    saved,
    summaries,
    fullSummary: joinDay(summaries, sessionPayloads, activeMinutes),
    needsGeneration: saved.some((entry) => entry === null),
    activeMinutes,
  }
}
