#!/usr/bin/env node

/**
 * Syncs docs/site/ to the landing page repo's pages/docs/ directory.
 *
 * Usage:
 *   npm run sync-docs                          # uses DOCS_REPO env var
 *   npm run sync-docs -- ../workscribe-site    # explicit path argument
 *   DOCS_REPO=../workscribe-site npm run sync-docs
 */

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(repoRoot, 'docs', 'site')

// Resolve target: CLI arg → env var → error
const targetRepoArg = process.argv[2]
const targetRepoEnv = process.env.DOCS_REPO
const targetRepo = targetRepoArg || targetRepoEnv

if (!targetRepo) {
  console.error('Error: landing page repo path required.')
  console.error('')
  console.error('  npm run sync-docs -- ../workscribe-landing-page')
  console.error('  DOCS_REPO=../workscribe-landing-page npm run sync-docs')
  process.exit(1)
}

const targetDir = path.resolve(repoRoot, targetRepo, 'pages', 'docs')

if (!fs.existsSync(sourceDir)) {
  console.error(`Error: source directory not found: ${sourceDir}`)
  process.exit(1)
}

if (!fs.existsSync(path.resolve(repoRoot, targetRepo))) {
  console.error(`Error: target repo not found: ${path.resolve(repoRoot, targetRepo)}`)
  process.exit(1)
}

// Create target directory if it doesn't exist
fs.mkdirSync(targetDir, { recursive: true })

// Copy all .md files from docs/site/ to pages/docs/
const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.md'))

if (files.length === 0) {
  console.log('No markdown files found in docs/site/')
  process.exit(0)
}

let copied = 0
for (const file of files) {
  const src = path.join(sourceDir, file)
  const dest = path.join(targetDir, file)
  fs.copyFileSync(src, dest)
  console.log(`  copied  ${file}  →  ${path.relative(repoRoot, dest)}`)
  copied++
}

console.log('')
console.log(`Done. ${copied} file${copied !== 1 ? 's' : ''} synced to ${targetDir}`)
