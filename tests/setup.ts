import { vi } from 'vitest'

// Globally suppress CLI output — every command handler imports logger.
// Tests that want to assert on log calls just import { log } from
// '../../src/utils/logger' and cast to the mock type; the vi.fn() instances
// are provided here and their call history is cleared by clearMocks: true.
vi.mock('../src/utils/logger', () => ({
  log: {
    plain: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  debugLog: vi.fn(),
}))
