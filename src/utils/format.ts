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
