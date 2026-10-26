import { describe, it, expect, vi } from 'vitest'

// Real filter, normaliser and redaction — only storage, config and git are faked — so this replays
// what the Claude Code hook does with the commands an agent runs while following the Workscribe skill.
vi.mock('fs', () => ({ default: { existsSync: vi.fn(() => false) } }))
vi.mock('../../src/db', () => ({
  insertEvent: vi.fn(),
  getLastEvent: vi.fn(),
  getLastEventForFile: vi.fn(),
  getLastEventForCwd: vi.fn(),
}))
// The normaliser reads the config (active profiles) when it loads, so the mock needs a value up front
vi.mock('../../src/config', async () => {
  const { createTestConfig } = await import('../helpers/config')
  return { readConfig: vi.fn(() => createTestConfig()) }
})
vi.mock('../../src/capture/git', () => ({ getGitContext: vi.fn(() => ({ repoName: 'api', branch: 'main' })) }))
vi.mock('../../src/capture/git-snapshot', () => ({ getCommitsSince: vi.fn(() => []) }))
vi.mock('../../src/capture/aider', () => ({ readLastAiderPrompt: vi.fn(() => null) }))
vi.mock('../../src/utils/paths', () => ({ PAUSE_FLAG_PATH: '/home/user/.workscribe/paused' }))

import { insertEvent } from '../../src/db'
import { captureCommand } from '../../src/capture'

const SKILL_COMMANDS = [
  'workscribe sessions --json',
  'workscribe sessions --json --date 2026-10-24',
  'cd ~/api && workscribe sessions --json',
  'workscribe sessions --json 2>/dev/null || true',
  'workscribe sessions --json; echo "exit=$?"',
  'workscribe sessions --json && cd -',
  "printf '%s' \"## api — 1h\" | workscribe sessions summary set --key 'api|2026-10-25T09:00:00.000Z'",
  [
    "workscribe sessions summary set --key 'api|2026-10-25T09:00:00.000Z' <<'EOF'",
    '## api (main) — 1h',
    "- Fixed the refresh race; didn't change the && fallback",
    'EOF',
  ].join('\n'),
]

function replay(command: string): void {
  captureCommand({ command, cwd: '/Users/dev/api', exitCode: null, durationMs: null, source: 'claude-code' })
}

describe('capturing the commands the Workscribe skill runs', () => {
  it.each(SKILL_COMMANDS)('stores nothing for %s', (command) => {
    replay(command)

    expect(insertEvent).not.toHaveBeenCalled()
  })

  it('still stores real work from the same agent session', () => {
    replay('npm test')
    replay('npm test && workscribe note "tests pass"')

    expect(insertEvent).toHaveBeenCalledTimes(2)
  })
})
