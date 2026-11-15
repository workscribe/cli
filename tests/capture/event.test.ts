import { describe, it, expect } from 'vitest'
import { exitCodeOf, FAILED_EXIT_CODE } from '../../src/capture/hooks/event'
import { isFailedExit } from '../../src/summary/commits'

describe('exitCodeOf', () => {
  it('stores a code as it is, a failure with no code as -1, and an unknown outcome as null', () => {
    expect(exitCodeOf({ kind: 'exit', code: 0 })).toBe(0)
    expect(exitCodeOf({ kind: 'exit', code: 3 })).toBe(3)
    expect(exitCodeOf({ kind: 'failed' })).toBe(FAILED_EXIT_CODE)
    expect(exitCodeOf({ kind: 'unknown' })).toBeNull()
  })

  it('makes a failure with no code read as failed everywhere, and an unknown one not', () => {
    expect(isFailedExit(FAILED_EXIT_CODE)).toBe(true)
    expect(isFailedExit(null)).toBe(false)
  })
})
