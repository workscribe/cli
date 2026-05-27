#!/usr/bin/env node

/**
 * Syncs docs/site/ to a target directory in the landing page repo.
 *
 * Usage:
 *   npm run sync-docs -- <repo-path> [target-subdir]
 *
 * Examples:
 *   npm run sync-docs -- ../workscribe-landing-page
 *   npm run sync-docs -- ../workscribe-landing-page content/docs
 *   DOCS_REPO=../workscribe-landing-page DOCS_SUBDIR=content/docs npm run sync-docs
 *
 * Defaults:
 *   repo path  — DOCS_REPO env var (required if not passed as argument)
 *   subdir     — DOCS_SUBDIR env var, or repo root if neither is set
 */

const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const sourceDir = path.join(repoRoot, 'docs', 'site')

// Resolve repo path: CLI arg 1 → env var → error
const targetRepo = process.argv[2] || process.env.DOCS_REPO

if (!targetRepo) {
  console.error('Error: landing page repo path required.')
  console.error('')
  console.error('  npm run sync-docs -- ../workscribe-landing-page')
  console.error('  npm run sync-docs -- ../workscribe-landing-page content/docs')
  console.error('  DOCS_REPO=../workscribe-landing-page npm run sync-docs')
  process.exit(1)
}

// Resolve subdir: CLI arg 2 → env var → repo root
const subdir = process.argv[3] || process.env.DOCS_SUBDIR || ''

const resolvedRepo = path.resolve(repoRoot, targetRepo)
const targetDir = subdir ? path.join(resolvedRepo, subdir) : resolvedRepo

if (!fs.existsSync(sourceDir)) {
  console.error(`Error: source directory not found: ${sourceDir}`)
  process.exit(1)
}

if (!fs.existsSync(resolvedRepo)) {
  console.error(`Error: target repo not found: ${resolvedRepo}`)
  process.exit(1)
}

fs.mkdirSync(targetDir, { recursive: true })

const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.md') || f.endsWith('.json'))

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
