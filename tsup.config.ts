import { defineConfig } from 'tsup'
import { readFileSync } from 'fs'
const { version } = JSON.parse(readFileSync('./package.json', 'utf-8')) as { version: string }

export default defineConfig({
  define: {
    __WORKSCRIBE_VERSION__: JSON.stringify(version),
  },
  entry: { index: 'src/index.ts' },
  format: ['cjs'],
  target: 'node20',
  clean: true,
  sourcemap: true,
  external: ['node:sqlite', 'better-sqlite3'],
  banner: {
    js: '#!/usr/bin/env node',
  },
})
