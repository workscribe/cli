import { describe, it, expect, vi } from 'vitest'

vi.mock('fs', () => ({
  default: { existsSync: vi.fn(() => true), readFileSync: vi.fn(() => ''), writeFileSync: vi.fn(), mkdirSync: vi.fn() },
}))
vi.mock('../../src/utils/paths', () => ({
  WORKSCRIBE_DIR: '/home/user/.workscribe',
  DEBUG_LOG_PATH: '/home/user/.workscribe/debug.log',
  CONFIG_PATH: '/home/user/.workscribe/config.json',
}))
vi.mock('../../src/config', () => ({ readConfig: vi.fn() }))

import fs from 'fs'
import { Command } from 'commander'
import { readConfig } from '../../src/config'
import { registerBugReport } from '../../src/cli/bug-report'
import { createTestConfig } from '../helpers/config'

async function writtenReport(): Promise<string> {
  const program = new Command()
  program.exitOverride()
  registerBugReport(program)
  await program.parseAsync(['bug-report'], { from: 'user' })
  return String(vi.mocked(fs.writeFileSync).mock.calls[0][1])
}

describe('workscribe bug-report', () => {
  it('redacts an API key left over from a 1.x config', async () => {
    vi.mocked(readConfig).mockReturnValue(createTestConfig({ ai: { provider: 'anthropic', apiKey: 'sk-ant-secret' } }))

    const report = await writtenReport()

    expect(report).not.toContain('sk-ant-secret')
    expect(report).toContain('"apiKey": "<redacted>"')
  })

  it('writes a 2.0 config, which has no ai block, without failing', async () => {
    vi.mocked(readConfig).mockReturnValue(createTestConfig())

    const report = await writtenReport()

    expect(report).toContain('--- Config (secrets redacted) ---')
    expect(report).not.toContain('could not read config')
  })
})
