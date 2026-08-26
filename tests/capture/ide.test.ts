import { describe, it, expect } from 'vitest'
import { IDE_DEDUP_WINDOW_MS, IDE_EVENT_TYPES, isIdeEventType } from '../../src/capture/ide'

describe('IDE_DEDUP_WINDOW_MS', () => {
  it('is 30 seconds', () => {
    expect(IDE_DEDUP_WINDOW_MS).toBe(30_000)
  })
})

describe('IDE_EVENT_TYPES', () => {
  it('includes code_edit', () => {
    expect(IDE_EVENT_TYPES.has('code_edit')).toBe(true)
  })

  it('includes debug_start', () => {
    expect(IDE_EVENT_TYPES.has('debug_start')).toBe(true)
  })

  it('includes debug_end', () => {
    expect(IDE_EVENT_TYPES.has('debug_end')).toBe(true)
  })

  it('includes task_run', () => {
    expect(IDE_EVENT_TYPES.has('task_run')).toBe(true)
  })

  it('does not include shell categories', () => {
    expect(IDE_EVENT_TYPES.has('building')).toBe(false)
    expect(IDE_EVENT_TYPES.has('testing')).toBe(false)
    expect(IDE_EVENT_TYPES.has('other')).toBe(false)
  })
})

describe('isIdeEventType', () => {
  it('returns true for code_edit', () => {
    expect(isIdeEventType('code_edit')).toBe(true)
  })

  it('returns true for debug_start', () => {
    expect(isIdeEventType('debug_start')).toBe(true)
  })

  it('returns true for debug_end', () => {
    expect(isIdeEventType('debug_end')).toBe(true)
  })

  it('returns true for task_run', () => {
    expect(isIdeEventType('task_run')).toBe(true)
  })

  it('returns false for unknown types', () => {
    expect(isIdeEventType('building')).toBe(false)
    expect(isIdeEventType('shell_command')).toBe(false)
    expect(isIdeEventType('')).toBe(false)
  })
})
