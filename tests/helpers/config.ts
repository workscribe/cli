import type { WorkscribeConfig } from '../../src/config'
import { DEFAULT_TICKET_PATTERN } from '../../src/capture/tickets'

// Single source of truth for a full, valid WorkscribeConfig test fixture.
// Mirrors src/config/index.ts's DEFAULTS — when the schema grows, update
// both in the same change so every test file picks it up automatically
// instead of each needing its own inline fixture patched separately.
export function createTestConfig(overrides: Partial<WorkscribeConfig> = {}): WorkscribeConfig {
  return {
    session: { idleTimeout: 30 },
    git: { qualifyRepoName: false },
    capture: {
      ignore: ['cd', 'ls', 'll', 'la', 'ls -la', 'ls -l', 'ls -a', 'pwd', 'clear', 'exit', 'history', 'man'],
      aiTools: true,
      includeAiderPrompt: true,
      profiles: [],
      agentEdits: true,
      agentMessages: false,
      excludePaths: [],
    },
    redact: { extra: [] },
    summary: { format: 'markdown' },
    tickets: { pattern: DEFAULT_TICKET_PATTERN },
    ...overrides,
  }
}
