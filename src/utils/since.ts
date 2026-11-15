import { localDateStr } from './format'

const DURATION = /^(\d+)([hdw])$/
const DATE = /^\d{4}-\d{2}-\d{2}$/
const UNIT_MS = { h: 3_600_000, d: 86_400_000, w: 604_800_000 }

/**
 * The start of a `--since` window as a UTC ISO string: a duration back from now (`6h`, `2d`, `1w`) or the start of
 * a local day (`YYYY-MM-DD`). Throws a message fit to show for anything else.
 */
export function parseSince(input: string, now: Date = new Date()): string {
  const duration = DURATION.exec(input)
  if (duration) {
    const start = new Date(now.getTime() - Number(duration[1]) * UNIT_MS[duration[2] as keyof typeof UNIT_MS])
    // A duration too long to be a date (`99999999999999w`) or zero is not one to use
    if (Number(duration[1]) > 0 && !isNaN(start.getTime())) return start.toISOString()
  }
  if (DATE.test(input)) {
    const start = new Date(`${input}T00:00:00`)
    // Rolled-over dates (2026-02-31) are not dates
    if (!isNaN(start.getTime()) && localDateStr(start) === input) return start.toISOString()
  }
  throw new Error(`Invalid --since: ${input} (use a duration like 6h, 2d or 1w, or a date like 2026-11-05)`)
}
