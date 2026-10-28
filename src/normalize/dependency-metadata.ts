// What a package-manager command installs or removes, and for which workspace — read word by word, so flags and
// their values (`--filter web`, `--registry <url>`) are never taken for package names. Pure.

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

/**
 * The package names after a command word — `npm install foo bar` → foo, bar. Flags are skipped, and so is the value
 * of a flag that takes one (`pnpm add --filter web zod` → zod).
 */
export function extractPackages(command: string, commandWords: string[]): string[] {
  const words = command.trim().split(/\s+/)
  const start = words.findIndex((word, index) => index > 0 && commandWords.includes(word))
  if (start === -1) return []
  const packages: string[] = []
  for (let index = start + 1; index < words.length; index++) {
    const word = words[index]
    if (FLAGS_WITH_VALUE.has(word)) index++
    else if (word && !word.startsWith('-')) packages.push(word)
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
