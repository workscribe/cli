import type { WorkscribeConfig } from '../../src/config'

// Single source of truth for a full, valid WorkscribeConfig test fixture.
// Mirrors src/config/index.ts's DEFAULTS — when the schema grows, update
// both in the same change so every test file picks it up automatically
// instead of each needing its own inline fixture patched separately.
export function createTestConfig(overrides: Partial<WorkscribeConfig> = {}): WorkscribeConfig {
  return {
    ai: { provider: 'anthropic', apiKey: 'sk-test', model: '', baseUrl: '' },
    session: { idleTimeout: 30 },
    git: { qualifyRepoName: false },
    capture: {
      ignore: ['cd', 'ls', 'll', 'la', 'ls -la', 'ls -l', 'ls -a', 'pwd', 'clear', 'exit', 'history', 'man'],
      aiTools: true,
      includeAiderPrompt: true,
      profiles: [],
    },
    redact: { extra: [] },
    summary: { format: 'markdown' },
    telemetry: { enabled: true, installId: 'existing-install-id' },
    ...overrides,
  }
}
