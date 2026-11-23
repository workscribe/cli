import { getDb } from '../db'
import { getSummariesOfDay } from '../db/summary-store'
import { keptSummaryTexts } from '../summary/kept'

/** The summaries saved for a day whose events are gone (WOR-179), best one per thread; none for a day that never had any. */
export function keptSummariesOf(date: string): string[] {
  return keptSummaryTexts(getSummariesOfDay(getDb(), date))
}
