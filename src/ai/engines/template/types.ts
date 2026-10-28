/** How test or build runs turned out: fixed after failing, all passing, still failing, or ran with no result known. */
export type Outcome = 'resolved' | 'passing' | 'failing' | 'ran'

/** How a pass/fail outcome for one event category is worded in a bullet. */
export interface OutcomeWording {
  category: string
  resolved: string
  passing: string
  failing: string
  ran: string
}
