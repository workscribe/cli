import { describe, it, expect } from 'vitest'
import { parseMetadata, withoutIntent } from '../../src/summary/event-metadata'

describe('withoutIntent', () => {
  it('removes the intent and keeps every other key', () => {
    expect(withoutIntent({ tool: 'vitest', intent: 'Run the tests', message: 'm' })).toEqual({
      tool: 'vitest',
      message: 'm',
    })
  })

  it('removes an intent whatever it holds', () => {
    expect(withoutIntent({ intent: 42 })).toEqual({})
    expect(withoutIntent({ intent: null })).toEqual({})
  })

  it('hands back the same object when there is no intent, and never changes its argument', () => {
    const plain = { tool: 'vitest' }
    const described = { tool: 'vitest', intent: 'Run the tests' }

    expect(withoutIntent(plain)).toBe(plain)
    withoutIntent(described)
    expect(described).toEqual({ tool: 'vitest', intent: 'Run the tests' })
  })
})

describe('parseMetadata', () => {
  it('is empty for no metadata, damaged metadata and metadata that is not an object', () => {
    expect(parseMetadata(null)).toEqual({})
    expect(parseMetadata('not json')).toEqual({})
    expect(parseMetadata('[1]')).toEqual({})
  })
})
