import { defineConfig } from 'tsup'
import { version } from './package.json'

export default defineConfig({
  define: {
    __WORKSCRIBE_VERSION__: JSON.stringify(version),
  },
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
