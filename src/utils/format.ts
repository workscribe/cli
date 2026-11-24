export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

export function formatDate(isoString: string): string {
  return new Date(isoString).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function todayDate(): string {
  return localDateStr(new Date())
}

export function parseDate(input: string): string {
  // Accepts YYYY-MM-DD, returns YYYY-MM-DD. Throws on invalid.
  const d = new Date(input + 'T00:00:00')
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`)
  return input
}

export const MS_PER_DAY = 24 * 60 * 60 * 1000

export function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** The start of a local `YYYY-MM-DD` day, as a local `Date`. */
export function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** The local YYYY-MM-DD an ISO timestamp falls on — the same day rule sessions are grouped by. */
export function localDateOf(isoString: string): string {
  return localDateStr(new Date(isoString))
}

/**
 * A local day's bounds as UTC ISO strings, [start, end) — the same day `date(captured_at, 'localtime')` picks,
 * but comparable against `captured_at` directly, so a query can use its index. Handles DST-length days.
 */
export function localDayBounds(date: string): { start: string; end: string } {
  const start = new Date(`${date}T00:00:00`)
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

// Returns Monday of the ISO week containing dateStr (YYYY-MM-DD)
export function startOfWeek(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay() // 0=Sun
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return localDateStr(d)
}

// Returns all YYYY-MM-DD strings from start to end inclusive
export function eachDayOfRange(start: string, end: string): string[] {
  const days: string[] = []
  const cur = new Date(start + 'T00:00:00')
  const last = new Date(end + 'T00:00:00')
  while (cur <= last) {
    days.push(localDateStr(cur))
    cur.setDate(cur.getDate() + 1)
  }
  return days
}

export function timeAgo(isoString: string, now = Date.now()): string {
  const elapsedMs = now - new Date(isoString).getTime()
  const minutes = Math.floor(elapsedMs / 60000)
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/** A local date (`2026-11-03`) as the week shows it: `Mon 3 Nov`. */
export function formatWeekday(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  // Noon UTC, formatted in UTC: the same calendar day whatever the machine's time zone
  return new Date(Date.UTC(year, month - 1, day, 12))
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .replace(',', '')
}
