import { describe, it, expect, vi } from 'vitest'

vi.mock('fs', () => ({ default: { readFileSync: vi.fn(() => '## api — 1h\n') } }))

import fs from 'fs'
import { readAllStdin } from '../../src/utils/stdin'

describe('readAllStdin', () => {
  it('reads everything from file descriptor 0', () => {
    expect(readAllStdin()).toBe('## api — 1h\n')
    expect(fs.readFileSync).toHaveBeenCalledWith(0, 'utf-8')
  })
})
