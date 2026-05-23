import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts' },
  format: ['cjs'],
  target: 'node22',
  clean: true,
  sourcemap: true,
  external: ['node:sqlite'],
  banner: {
    js: '#!/usr/bin/env node',
  },
})
