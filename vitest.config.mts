import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Mirrors tsup.config.ts's `define` — __WORKSCRIBE_VERSION__ is a build-time
  // constant with no vitest equivalent otherwise.
  define: {
    __WORKSCRIBE_VERSION__: JSON.stringify('0.0.0-test'),
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    clearMocks: true,
    unstubEnvs: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/db/migrations/**', 'src/**/__mocks__/**'],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
    },
  },
})
