import { describe, it, expect } from 'vitest'
import { keptSummaryTexts, renderKeptDay, renderKeptDayAs, type KeptSummaryRow } from '../../src/summary/kept'

const row = (overrides: Partial<KeptSummaryRow> = {}): KeptSummaryRow => ({
  source_key: 'api|2026-08-01T09:00:00.000Z',
  engine: 'skill',
  text: 'skill text',
  created_at: '2026-08-02T10:00:00.000Z',
  ...overrides,
})

describe('keptSummaryTexts', () => {
  it('gives one summary per thread, the skill one over an older provider one', () => {
    const rows = [row({ engine: 'legacy', text: 'old text' }), row({ text: 'skill text' })]

    expect(keptSummaryTexts(rows)).toEqual(['skill text'])
  })

  it('keeps each thread of the day, in the order they were saved', () => {
    const rows = [
      row({ source_key: 'api|2026-08-01T09:00:00.000Z', text: 'first' }),
      row({ source_key: 'web|2026-08-01T13:00:00.000Z', text: 'second' }),
    ]

    expect(keptSummaryTexts(rows)).toEqual(['first', 'second'])
  })

  it('does not show a template row, which is a stored leftover that was never what people read', () => {
    expect(keptSummaryTexts([row({ engine: 'template', text: 'stale' })])).toEqual([])
  })

  it('shows a row with no key on its own, instead of merging it with another', () => {
    const rows = [row({ source_key: null, text: 'a' }), row({ source_key: null, text: 'b' })]

    expect(keptSummaryTexts(rows)).toEqual(['a', 'b'])
  })

  it('has nothing for a day with no summaries', () => {
    expect(keptSummaryTexts([])).toEqual([])
  })
})

describe('rendering a kept day', () => {
  it('puts the summaries first and explains why there is nothing else', () => {
    const markdown = renderKeptDay(['one', 'two'])

    expect(markdown.startsWith('one\n\ntwo\n\n')).toBe(true)
    expect(markdown).toContain('has been removed')
  })

  it('is plain text, with no markdown, for the text format', () => {
    const text = renderKeptDayAs('text', '2026-08-01', ['## api — 1h\n\n- fixed it'])

    expect(text).not.toContain('##')
    expect(text).toContain('has been removed')
  })

  it('is one JSON document for the json format', () => {
    expect(JSON.parse(renderKeptDayAs('json', '2026-08-01', ['one']))).toEqual({
      date: '2026-08-01',
      activeMinutes: null,
      sessions: [],
      activityRemoved: true,
      keptSummaries: ['one'],
    })
  })
})
