import { describe, it, expect } from 'vitest'
import { getMetaValue, setMetaValue } from '../../src/db/jobs/store'
import {
  ANNOUNCED_AT_KEY,
  FIRST_REMOVAL_KEY,
  LAST_RUN_KEY,
  WARNED_KEY,
  limitsShortened,
  restartAnnouncement,
} from '../../src/db/retention-state'
import { openTemporaryDatabase } from '../helpers/retention-db'

describe('limitsShortened', () => {
  const before = { days: 100, summaryDays: 365 }

  it('is true for fewer days of events', () => {
    expect(limitsShortened(before, { days: 60, summaryDays: 365 })).toBe(true)
  })

  it('is true for fewer days of summaries, or summaries that had no limit', () => {
    expect(limitsShortened(before, { days: 100, summaryDays: 200 })).toBe(true)
    expect(limitsShortened({ days: 100, summaryDays: null }, { days: 100, summaryDays: 200 })).toBe(true)
  })

  it('is false for the same or longer limits, or summaries that lost their limit', () => {
    expect(limitsShortened(before, before)).toBe(false)
    expect(limitsShortened(before, { days: 365, summaryDays: 500 })).toBe(false)
    expect(limitsShortened(before, { days: 100, summaryDays: null })).toBe(false)
  })
})

describe('restartAnnouncement', () => {
  it('forgets the announcement, the first removal day and the reminders, and nothing else', () => {
    const { db } = openTemporaryDatabase({ gatesDone: true })
    for (const key of [ANNOUNCED_AT_KEY, FIRST_REMOVAL_KEY, WARNED_KEY, LAST_RUN_KEY]) setMetaValue(db, key, 'x')

    restartAnnouncement(db)

    expect(getMetaValue(db, ANNOUNCED_AT_KEY)).toBeNull()
    expect(getMetaValue(db, FIRST_REMOVAL_KEY)).toBeNull()
    expect(getMetaValue(db, WARNED_KEY)).toBeNull()
    expect(getMetaValue(db, LAST_RUN_KEY)).toBe('x')
  })
})
