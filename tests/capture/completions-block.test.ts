import { describe, it, expect } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import {
  completionsBlock,
  hasCompletionsBlock,
  isCompletionsBlockOutdated,
  removeCompletionsBlock,
  replaceCompletionsBlock,
} from '../../src/capture/completions-block'

const FILE = '/home/dev/.workscribe/completion.zsh'
// What Workscribe ≤ 2.0.0 appended — unguarded, so a deleted script errored in every new terminal
const OLD_ZSH = `\n# Workscribe completions\nautoload -Uz compinit && compinit\nsource "${FILE}"\n`
const OLD_BASH = `\n# Workscribe completions\nsource "/home/dev/.workscribe/completion.bash"\n`
const rc = (block: string) => `export PATH="$HOME/bin:$PATH"\n${block}alias ll="ls -la"\n`

describe('completionsBlock', () => {
  it('guards the zsh source line, compinit included', () => {
    expect(completionsBlock('zsh', FILE)).toBe(
      `# Workscribe completions\nif [ -f "${FILE}" ]; then autoload -Uz compinit && compinit; source "${FILE}"; fi`
    )
  })

  it('guards the bash source line', () => {
    expect(completionsBlock('bash', '/x/completion.bash')).toBe(
      '# Workscribe completions\n[ -f "/x/completion.bash" ] && source "/x/completion.bash"'
    )
  })
})

describe('older unguarded blocks', () => {
  it.each([
    ['zsh 3-line', OLD_ZSH, 'zsh', FILE],
    ['bash 2-line', OLD_BASH, 'bash', '/home/dev/.workscribe/completion.bash'],
  ])('detects and rewrites the %s block without leaving stray lines', (_shape, block, shell, file) => {
    const content = rc(block)
    const current = completionsBlock(shell, file)

    expect(isCompletionsBlockOutdated(content, current)).toBe(true)
    const rewritten = replaceCompletionsBlock(content, current)
    expect(rewritten).toBe(`export PATH="$HOME/bin:$PATH"\n\n${current}\nalias ll="ls -la"\n`)
    expect(rewritten.match(/autoload/g)?.length ?? 0).toBe(shell === 'zsh' ? 1 : 0)
    expect(isCompletionsBlockOutdated(rewritten, current)).toBe(false)
  })

  it('is not outdated when there is no block at all', () => {
    expect(isCompletionsBlockOutdated('export A=1\n', completionsBlock('zsh', FILE))).toBe(false)
    expect(hasCompletionsBlock('export A=1\n')).toBe(false)
  })
})

describe('removeCompletionsBlock', () => {
  it.each([
    ['old zsh', OLD_ZSH],
    ['old bash', OLD_BASH],
    ['guarded', `\n${completionsBlock('zsh', FILE)}\n`],
  ])('removes the %s block and leaves the rest of the file as it was', (_shape, block) => {
    expect(removeCompletionsBlock(rc(block))).toBe('export PATH="$HOME/bin:$PATH"\nalias ll="ls -la"\n')
  })

  it('leaves a file without a block unchanged', () => {
    expect(removeCompletionsBlock('export A=1\n')).toBe('export A=1\n')
  })
})

describe('data safety: only Workscribe-shaped blocks are touched', () => {
  it('leaves a lone marker and everything after it alone, even with an unrelated source line later', () => {
    const content = 'x\n# Workscribe completions\nalias ll=ls\nexport P=1\nsource "$HOME/.cargo/env"\ny\n'

    expect(hasCompletionsBlock(content)).toBe(false)
    expect(removeCompletionsBlock(content)).toBe(content)
    expect(replaceCompletionsBlock(content, completionsBlock('zsh', FILE))).toBe(content)
    expect(isCompletionsBlockOutdated(content, completionsBlock('zsh', FILE))).toBe(false)
  })

  it("leaves a marker followed by someone else's source line alone", () => {
    const content = '# Workscribe completions\nsource "$HOME/.cargo/env"\n'
    expect(removeCompletionsBlock(content)).toBe(content)
  })

  it('removes every duplicate block older versions of init appended', () => {
    const content = rc(OLD_ZSH + OLD_ZSH)
    expect(removeCompletionsBlock(content)).toBe('export PATH="$HOME/bin:$PATH"\nalias ll="ls -la"\n')
  })

  it('reports duplicates as outdated, and replacing leaves exactly one current block', () => {
    const current = completionsBlock('zsh', FILE)
    const content = rc(`\n${current}\n` + OLD_ZSH)

    expect(isCompletionsBlockOutdated(content, current)).toBe(true)
    const rewritten = replaceCompletionsBlock(content, current)
    expect(rewritten.match(/# Workscribe completions/g)).toHaveLength(1)
    expect(isCompletionsBlockOutdated(rewritten, current)).toBe(false)
    expect(rewritten).toContain('alias ll="ls -la"')
  })

  it('keeps Windows line endings and is not fooled by them', () => {
    const current = completionsBlock('zsh', FILE)
    const content = `a\r\n${current.replace('\n', '\r\n')}\r\nb\r\n`

    expect(isCompletionsBlockOutdated(content, current)).toBe(false)
    const old = `a\r\n# Workscribe completions\r\nautoload -Uz compinit && compinit\r\nsource "${FILE}"\r\nb\r\n`
    expect(replaceCompletionsBlock(old, current)).toBe(`a\r\n${current.replace('\n', '\r\n')}\r\nb\r\n`)
  })
})

function runsIn(shell: string): boolean {
  try {
    execFileSync(shell, ['-c', 'true'])
    return true
  } catch {
    return false
  }
}

// The point of the guard: once the script is gone, new terminals print nothing
describe.each([
  ['zsh', ['-f', '-c']],
  ['bash', ['--norc', '-c']],
])('the guarded block in a real %s', (shell, flags) => {
  it.skipIf(!runsIn(shell))('prints nothing and succeeds when the completion script is missing', () => {
    const block = completionsBlock(shell, '/nonexistent/workscribe/completion.script')
    const result = spawnSync(shell, [...flags, `${block}\necho done`], { encoding: 'utf-8' })
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe('done\n')
    expect(result.status).toBe(0)
  })
})

// And the reason for the change: the old unguarded line does error in the same situation
describe('the old unguarded zsh line in a real zsh', () => {
  it.skipIf(!runsIn('zsh'))('errors when the completion script is missing', () => {
    const result = spawnSync('zsh', ['-f', '-c', 'source "/nonexistent/workscribe/completion.zsh"; echo done'], {
      encoding: 'utf-8',
    })
    expect(result.stderr).toContain('no such file or directory')
  })
})
