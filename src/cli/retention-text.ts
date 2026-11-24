import type { RemovalPreview } from '../db/retention-schedule'

// Words shared by what `workscribe retention` shows and what a run says (WOR-179).

/** What a removal takes, as "340 captured events, from 12 days". */
export function removalCounts(preview: RemovalPreview): string {
  const events = preview.events === 1 ? '1 captured event' : `${preview.events} captured events`
  const days = preview.eventDays === 1 ? '1 day' : `${preview.eventDays} days`
  return `${events}, from ${days}`
}
