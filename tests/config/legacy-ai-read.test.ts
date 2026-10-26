import { describe, it, expect, vi } from 'vitest'

vi.mock('fs', () => ({
  default: { existsSync: vi.fn(() => true), readFileSync: vi.fn() },
}))
vi.mock('../../src/utils/paths', () => ({ CONFIG_PATH: '/home/user/.workscribe/config.json' }))

import fs from 'fs'
import { readConfig } from '../../src/config'

describe('readConfig with a 1.x config', () => {
  it('keeps the old ai block from the file, so 2.0 can tell the user and redact the key', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(
      JSON.stringify({ ai: { provider: 'anthropic', apiKey: 'sk-old' }, summary: { engine: 'provider' } })
    )

    const config = readConfig()

    expect(config.ai).toEqual({ provider: 'anthropic', apiKey: 'sk-old' })
    expect(config.summary.engine).toBe('provider')
    expect(config.summary.format).toBe('markdown')
  })

  it('has no ai block for a 2.0 config', () => {
    vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ session: { idleTimeout: 45 } }))

    expect(readConfig().ai).toBeUndefined()
  })
})
