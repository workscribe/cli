import { describe, it, expect, vi } from 'vitest'
import { reclassifiedEvent } from '../../src/normalize/reclassify'

describe('reclassifiedEvent', () => {
  it('returns the new event, whose metadata replaces the old hint/tool', () => {
    const classify = vi.fn(() => ({ category: 'testing', metadata: { tool: 'npm' } }))

    expect(reclassifiedEvent('cd app && npm test', { classify, aiToolsEnabled: true })).toEqual({
      category: 'testing',
      metadata: { tool: 'npm' },
    })
    expect(classify).toHaveBeenCalledWith('cd app && npm test')
  })

  it('leaves a command that is still unclassified alone', () => {
    const classify = () => ({ category: 'other', metadata: {} })

    expect(reclassifiedEvent('gh run view 1', { classify, aiToolsEnabled: true })).toBeNull()
  })

  it('creates no AI session when capture.aiTools is off', () => {
    const classify = () => ({ category: 'ai_session', metadata: { tool: 'claude' } })

    expect(reclassifiedEvent('claude', { classify, aiToolsEnabled: false })).toBeNull()
    expect(reclassifiedEvent('claude', { classify, aiToolsEnabled: true })?.category).toBe('ai_session')
  })

  it('never stores a commit message file path, which only capture can read at the time', () => {
    const classify = () => ({ category: 'shipping', metadata: { message: null, messageFile: '/tmp/msg.txt' } })

    expect(reclassifiedEvent('git commit -F /tmp/msg.txt', { classify, aiToolsEnabled: true })).toEqual({
      category: 'shipping',
      metadata: { message: null },
    })
  })
})
