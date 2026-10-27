// The `# Workscribe completions` block `init` adds to ~/.zshrc / ~/.bashrc. Pure text handling, so the rc-file
// I/O in shell-hook.ts stays thin. The block guards its `source` line, so it does nothing — and prints nothing —
// once the completion script is gone (e.g. after the package and its data folder are removed).
//
// This code edits the user's own rc files, so it only ever touches lines in the exact shapes Workscribe wrote:
// a marker line directly followed by the line(s) below, sourcing Workscribe's own `completion.<shell>` script.
// A marker on its own, or followed by anything else, is left alone.

export const COMPLETIONS_MARKER = '# Workscribe completions'

const ZSH_COMPINIT = 'autoload -Uz compinit && compinit'
// Workscribe's own script: `<data folder>/completion.zsh` or `completion.bash`
const OWN_SCRIPT = '"[^"]*completion\\.(?:zsh|bash)"'
// The line(s) under the marker, in every shape Workscribe has written
const GUARDED_ZSH = new RegExp(`^if \\[ -f ${OWN_SCRIPT} \\]; then ${ZSH_COMPINIT}; source ${OWN_SCRIPT}; fi$`)
const GUARDED_BASH = new RegExp(`^\\[ -f ${OWN_SCRIPT} \\] && source ${OWN_SCRIPT}$`)
const UNGUARDED_SOURCE = new RegExp(`^source ${OWN_SCRIPT}$`)

/** The block for a shell; `file` is the generated completion script it sources. */
export function completionsBlock(shellName: string, file: string): string {
  const guardedSource =
    shellName === 'zsh'
      ? `if [ -f "${file}" ]; then ${ZSH_COMPINIT}; source "${file}"; fi`
      : `[ -f "${file}" ] && source "${file}"`
  return `${COMPLETIONS_MARKER}\n${guardedSource}`
}

/** Lines of a block: `first` is the marker line, `last` the line that sources the script (inclusive). */
interface BlockLines {
  first: number
  last: number
}

/** A file's lines, compared without a Windows `\r` but written back with it. */
interface RcLines {
  lines: string[]
  lineEnding: '' | '\r'
}

function splitLines(content: string): RcLines {
  return { lines: content.split('\n'), lineEnding: content.includes('\r\n') ? '\r' : '' }
}

function bare(line: string | undefined): string {
  return (line ?? '').replace(/\r$/, '')
}

/** How many lines after the marker belong to the block, or 0 if what follows isn't a Workscribe block. */
function blockLengthAfterMarker(lines: string[], markerIndex: number): number {
  const next = bare(lines[markerIndex + 1])
  if (GUARDED_ZSH.test(next) || GUARDED_BASH.test(next) || UNGUARDED_SOURCE.test(next)) return 1
  if (next === ZSH_COMPINIT && UNGUARDED_SOURCE.test(bare(lines[markerIndex + 2]))) return 2
  return 0
}

/** Every Workscribe completions block — older versions of `init` could append more than one. */
function findBlocks(lines: string[]): BlockLines[] {
  const blocks: BlockLines[] = []
  for (let index = 0; index < lines.length; index++) {
    if (bare(lines[index]) !== COMPLETIONS_MARKER) continue
    const length = blockLengthAfterMarker(lines, index)
    if (length === 0) continue
    blocks.push({ first: index, last: index + length })
    index += length
  }
  return blocks
}

function blockText(lines: string[], block: BlockLines): string {
  return lines
    .slice(block.first, block.last + 1)
    .map(bare)
    .join('\n')
}

export function hasCompletionsBlock(content: string): boolean {
  return findBlocks(splitLines(content).lines).length > 0
}

/** There's a block that isn't the current one (typically an unguarded block from an older version), or several. */
export function isCompletionsBlockOutdated(content: string, currentBlock: string): boolean {
  const { lines } = splitLines(content)
  const blocks = findBlocks(lines)
  if (blocks.length === 0) return false
  return blocks.length > 1 || blockText(lines, blocks[0]) !== currentBlock
}

/**
 * Rebuilds the file from its lines: `replacement` takes the place of the first block, the other blocks go — each
 * with the one blank line `installCompletions` put before it — and every other line stays exactly as it was.
 */
function rebuild(content: string, replacement: string | null): string {
  const { lines, lineEnding } = splitLines(content)
  const blocks = findBlocks(lines)
  if (blocks.length === 0) return content
  const dropped = new Set<number>()
  blocks.forEach((block, blockIndex) => {
    const isReplaced = blockIndex === 0 && replacement !== null
    for (let index = block.first; index <= block.last; index++) dropped.add(index)
    if (!isReplaced && block.first > 0 && bare(lines[block.first - 1]) === '') dropped.add(block.first - 1)
  })
  const replacementLines = replacement === null ? [] : replacement.split('\n').map((line) => line + lineEnding)
  return lines
    .flatMap((line, index) => {
      if (replacement !== null && index === blocks[0].first) return replacementLines
      return dropped.has(index) ? [] : [line]
    })
    .join('\n')
}

/** Replaces the first block with `newBlock` and removes any duplicates. */
export function replaceCompletionsBlock(content: string, newBlock: string): string {
  return rebuild(content, newBlock)
}

/** Removes every block (and the blank line before each), leaving the rest of the file as it was. */
export function removeCompletionsBlock(content: string): string {
  return rebuild(content, null)
}
