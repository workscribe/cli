import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { localDayBounds } from '../../src/utils/format'

// The range query that keeps `context --file` cheap must pick exactly the day `getEventsForDate` does with
// `date(captured_at, 'localtime')` — both use this process's time zone
describe('localDayBounds', () => {
  const db = new DatabaseSync(':memory:')
  const localDateInSqlite = (iso: string) =>
    (db.prepare("SELECT date($iso, 'localtime') AS day").get({ iso }) as { day: string }).day

  it.each(['2026-10-28', '2026-03-29', '2026-10-25', '2026-12-31'])(
    '%s: the instants either side of local midnight fall on the same days SQLite gives them',
    (date) => {
      const { start, end } = localDayBounds(date)
      const justBefore = new Date(new Date(start).getTime() - 1).toISOString()
      const lastMoment = new Date(new Date(end).getTime() - 1).toISOString()

      expect(localDateInSqlite(start)).toBe(date)
      expect(localDateInSqlite(lastMoment)).toBe(date)
      expect(localDateInSqlite(justBefore)).not.toBe(date)
      expect(localDateInSqlite(end)).not.toBe(date)
    }
  )

  it('runs from local midnight to the next local midnight', () => {
    const { start, end } = localDayBounds('2026-10-28')
    expect(new Date(start).getHours()).toBe(0)
    expect(new Date(end).getHours()).toBe(0)
    expect(new Date(end).getDate() - new Date(start).getDate()).toBe(1)
  })
})
