import { describe, it, expect } from 'vitest'
import { collectNotes, contractEvents } from '../../../src/summary/contract/utils'
import { capturedRow, row } from './fixtures'

describe('contractEvents', () => {
  it('drops exploring and linting by default, like the AI engines', () => {
    const rows = [capturedRow('cat README.md'), capturedRow('npx eslint .'), capturedRow('npm test')]

    expect(contractEvents(rows, []).map((event) => event.category)).toEqual(['testing'])
  })

  it('keeps a default-excluded category when includeCategories opts in', () => {
    const rows = [capturedRow('cat README.md'), capturedRow('npm test')]

    expect(contractEvents(rows, ['exploring']).map((event) => event.category)).toEqual(['exploring', 'testing'])
  })

  it('never reports notes as events, even when opted in', () => {
    const rows = [row({ category: 'note', metadata: '{"text":"paired"}' })]

    expect(contractEvents(rows, ['note'])).toEqual([])
  })
})

describe('collectNotes', () => {
  it('returns note texts in order and skips empty or malformed ones', () => {
    const rows = [
      row({ category: 'note', metadata: '{"text":"first"}' }),
      row({ category: 'note', metadata: '{not json' }),
      row({ category: 'note', metadata: '{"text":""}' }),
      capturedRow('npm test'),
      row({ category: 'note', metadata: '{"text":"second"}' }),
    ]

    expect(collectNotes(rows)).toEqual(['first', 'second'])
  })
})
