import { describe, it, expect } from 'vitest'
import { editMetadata, mergedEditMetadata, parseLineCount } from '../../src/capture/edit-counts'

const EDITED_AT = '2026-11-07T10:00:20.000Z'

describe('parseLineCount', () => {
  it.each([
    ['12', 12],
    ['0', 0],
    [' 7 ', 7],
  ])('reads %j as %d', (value, expected) => {
    expect(parseLineCount(value)).toBe(expected)
  })

  it.each([['-1'], ['abc'], ['1.5'], [''], ['99999999999999999999'], [undefined], [3], [true]])(
    'treats %j as unknown',
    (value) => {
      expect(parseLineCount(value)).toBeNull()
    }
  )
})

describe('editMetadata', () => {
  it('stores both counts', () => {
    expect(JSON.parse(editMetadata({ linesAdded: 3, linesRemoved: 1 }))).toEqual({ linesAdded: 3, linesRemoved: 1 })
  })

  it('stores unknown counts as null, so every edit has the same shape', () => {
    expect(JSON.parse(editMetadata({ linesAdded: null, linesRemoved: null }))).toEqual({
      linesAdded: null,
      linesRemoved: null,
    })
    expect(JSON.parse(editMetadata({ linesAdded: 4, linesRemoved: null }))).toEqual({
      linesAdded: 4,
      linesRemoved: null,
    })
  })
})

describe('mergedEditMetadata', () => {
  function merged(stored: string | null, linesAdded: number | null, linesRemoved: number | null) {
    return JSON.parse(mergedEditMetadata(stored, { linesAdded, linesRemoved }, EDITED_AT))
  }

  it('adds known counts and records the latest edit', () => {
    expect(merged('{"linesAdded":3,"linesRemoved":1}', 3, 1)).toEqual({
      linesAdded: 6,
      linesRemoved: 2,
      lastEditAt: EDITED_AT,
    })
  })

  it('keeps a known count when the new edit does not know it, and takes one the stored edit did not know', () => {
    expect(merged('{"linesAdded":3,"linesRemoved":null}', null, 5)).toMatchObject({ linesAdded: 3, linesRemoved: 5 })
  })

  it('stays unknown while no edit knew the count', () => {
    expect(merged('{"linesAdded":null,"linesRemoved":null}', null, null)).toMatchObject({
      linesAdded: null,
      linesRemoved: null,
      lastEditAt: EDITED_AT,
    })
  })

  it('treats a save from before line counts, or corrupt metadata, as unknown', () => {
    expect(merged(null, 2, 0)).toEqual({ linesAdded: 2, linesRemoved: 0, lastEditAt: EDITED_AT })
    expect(merged('{not json', 2, 0)).toEqual({ linesAdded: 2, linesRemoved: 0, lastEditAt: EDITED_AT })
  })

  it('ignores a stored count that is not a non-negative integer', () => {
    expect(merged('{"linesAdded":"3","linesRemoved":-2}', 1, 1)).toMatchObject({ linesAdded: 1, linesRemoved: 1 })
  })
})
