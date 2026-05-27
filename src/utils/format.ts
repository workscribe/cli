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
  return new Date().toISOString().split('T')[0]
}

export function parseDate(input: string): string {
  // Accepts YYYY-MM-DD, returns YYYY-MM-DD. Throws on invalid.
  const d = new Date(input + 'T00:00:00')
  if (isNaN(d.getTime())) throw new Error(`Invalid date: ${input}`)
  return input
}

function localDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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

// Returns ISO week string YYYY-WW for a date
export function isoWeekKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const jan4 = new Date(d.getFullYear(), 0, 4)
  const weekNum = Math.ceil(((d.getTime() - jan4.getTime()) / 86400000 + jan4.getDay() + 1) / 7)
  return `${d.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
}
