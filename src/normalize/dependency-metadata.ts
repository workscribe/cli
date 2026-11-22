// What a package-manager command installs or removes, and for which workspace — read word by word, so flags and
// their values (`--filter web`, `--registry <url>`) are never taken for package names. Pure.

import { closingQuotePositions, maskLiteralText, maskQuotedText } from '../capture/shell-syntax'

// Package-manager flags whose next word is their value, not a package.
// (`-w` isn't here: npm's takes a value but pnpm's — workspace root — doesn't.)
const FLAGS_WITH_VALUE = new Set([
  '--filter',
  '-F',
  '--registry',
  '--workspace',
  '--dir',
  '-C',
  '--prefix',
  '--tag',
  '--cwd',
])

export const INSTALL_WORDS = ['install', 'i', 'add']
export const REMOVE_WORDS = ['remove', 'rm', 'uninstall', 'un']

// What the shell expands before the package manager runs: `$VAR`, `${VAR}`, `$(…)`, backticks, `<(…)` and `>(…)`
const EXPANSION = /[$`]|[<>]\(/
const SUBSTITUTION_OPENERS = ['$(', '<(', '>(']

/** Whether the shell expands this word, so it is not a name the package manager is given. Single-quoted text isn't. */
export function isShellExpansion(word: string): boolean {
  return EXPANSION.test(maskLiteralText(word))
}

function countOf(text: string, character: string): number {
  return text.split(character).length - 1
}

/**
 * The names left once the shell expansions are gone, for names stored by a capture that cut `$(cat list.txt)` at its
 * space (`$(cat`, `list.txt)`): the words after an unclosed `$(` or backtick belong to it, so they go too.
 */
export function withoutShellExpansions(names: string[]): string[] {
  let openParentheses = 0
  let isInBackticks = false
  return names.filter((name) => {
    const masked = maskLiteralText(name)
    const isInsideExpansion = openParentheses > 0 || isInBackticks
    if (!isInsideExpansion && !EXPANSION.test(masked)) return true
    openParentheses = Math.max(0, openParentheses + countOf(masked, '(') - countOf(masked, ')'))
    if (countOf(masked, '`') % 2 === 1) isInBackticks = !isInBackticks
    return false
  })
}

/** Where the `)` closing the substitution opened at `openIndex` is, or the last position when it never closes. */
function closeOfSubstitution(text: string, openIndex: number): number {
  let depth = 0
  for (let index = openIndex + 1; index < text.length; index++) {
    if (text[index] === '(') depth++
    if (text[index] === ')' && depth === 0) return index
    if (text[index] === ')') depth--
  }
  return text.length - 1
}

/** Where the backtick closing the one opened at `openIndex` is, or the last position when it never closes. */
function closeOfBacktick(text: string, openIndex: number): number {
  const close = text.indexOf('`', openIndex + 1)
  return close === -1 ? text.length - 1 : close
}

/** The text with every substitution span blanked (positions kept), so the spaces inside one don't split a word. */
function maskSubstitutions(text: string): string {
  const masked = [...text]
  for (let index = 0; index < text.length; index++) {
    const isParenthesized = SUBSTITUTION_OPENERS.some((opener) => text.startsWith(opener, index))
    if (!isParenthesized && text[index] !== '`') continue
    const last = isParenthesized ? closeOfSubstitution(text, index + 1) : closeOfBacktick(text, index)
    masked.fill('_', index, last + 1)
    index = last
  }
  return masked.join('')
}

/** Quote marks with none closing (`npm i "a b`, `don't`): the quoting can't be read, so the text is split plainly. */
function hasUnreadableQuotes(command: string): boolean {
  return /['"]/.test(command) && closingQuotePositions(command).size === 0
}

/**
 * The command's words as the shell splits them: quoted text and a whole `$(…)` or backtick span stay in one word.
 * Text whose quotes can't be read splits on whitespace outside the substitutions, so one stray quote mark never
 * hides the words after it.
 */
function commandWordsOf(command: string): string[] {
  const shape = maskSubstitutions(hasUnreadableQuotes(command) ? command : maskQuotedText(command))
  return [...shape.matchAll(/\S+/g)].map((match) => command.slice(match.index, match.index + match[0].length))
}

/**
 * The package names after a command word — `npm install foo bar` → foo, bar. Flags are skipped, and so is the value
 * of a flag that takes one (`pnpm add --filter web zod` → zod). A word the shell expands (`$(cat list.txt)`, `$PKG`)
 * isn't a name: the package manager only sees what it expands to.
 */
export function extractPackages(command: string, commandWords: string[]): string[] {
  const words = commandWordsOf(command)
  const start = words.findIndex((word, index) => index > 0 && commandWords.includes(word))
  if (start === -1) return []
  const packages: string[] = []
  for (let index = start + 1; index < words.length; index++) {
    const word = words[index]
    if (FLAGS_WITH_VALUE.has(word)) index++
    else if (!word.startsWith('-') && !isShellExpansion(word)) packages.push(word)
  }
  return packages
}

/** The workspace a pnpm `--filter` / `-F` command targets, if any. */
function workspaceOf(command: string): string | null {
  const words = command.trim().split(/\s+/)
  const filter = words.findIndex((word) => word === '--filter' || word === '-F')
  if (filter !== -1) return words[filter + 1] ?? null
  return words.find((word) => word.startsWith('--filter='))?.slice('--filter='.length) ?? null
}

/** Dependency metadata, with `action: 'remove'` for removals and the workspace when the command targets one. */
export function dependencyMetadata(
  tool: string,
  command: string,
  commandWords: string[],
  action?: 'remove'
): Record<string, unknown> {
  const workspace = workspaceOf(command)
  return {
    tool,
    packages: extractPackages(command, commandWords),
    ...(action ? { action } : {}),
    ...(workspace ? { workspace } : {}),
  }
}
