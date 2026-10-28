import { describe, it, expect, vi } from 'vitest'
// Only the built-in rules: no profiles or AI-tool registry from the machine running the tests
vi.mock('../../src/profiles/loader', () => ({ getActiveProfileRules: vi.fn(() => []) }))
vi.mock('../../src/config/registry', () => ({
  loadAIToolRegistry: vi.fn(() => [
    { tool: 'claude', displayName: 'Claude Code', pattern: '^claude\\b', hook: 'claude-code', contextSource: 'hook' },
  ]),
}))

import { normalizeCommand } from '../../src/normalize/patterns'

/** The event as it's stored: `matchedStep` is only for capture (see the matchedStep tests below) */
function classified(command: string) {
  const { category, metadata } = normalizeCommand(command)
  return { category, metadata }
}
import { STEP_CATEGORY_PRIORITY } from '../../src/normalize/compound'

const category = (command: string) => normalizeCommand(command).category

// Shapes from real Claude Code sessions (paths shortened)
describe('normalizeCommand — compound commands', () => {
  it.each([
    ['cd x && pnpm nx test shell 2>&1 | tail -40; npx tsc --noEmit', 'testing'],
    ['pnpm exec tsc -p a.json --noEmit; echo "exit=$?"', 'building'],
    ['d=node_modules/x; cat $d/package.json | grep v', 'exploring'],
    ['(cd streambox && pnpm exec tsc -p shell/tsconfig.app.json --noEmit; echo tsc=$?)', 'building'],
    ['pnpm nx run-many -t lint --skip-nx-cache 2>&1 | grep -aB2 warning', 'linting'],
    ['for f in a b; do npm run build; done', 'building'],
    ['for f in a b; do sed -n 1p $f; done', 'other'],
    ['gh run view 123 --log-failed', 'other'],
    ['for f in $(npm test); do echo $f; done', 'testing'],
    ["git commit -F - <<EOF\nBuilt at $(date), don't merge\nEOF\nnpm test", 'testing'],
    ['git status && npm test', 'testing'],
    ['npm run build && git add . && git commit -m "x"', 'building'],
    ['cd app && npm test', 'testing'],
    ['NODE_ENV=test npm test 2>&1 | tail', 'testing'],
    ['f=$(find . -name x.ts); sed -n 1p $f', 'exploring'],
    ['f=$(find . -name x.ts)', 'exploring'],
  ])('%s → %s', (command, expected) => {
    expect(category(command)).toBe(expected)
  })

  it("takes the primary step's metadata", () => {
    expect(classified('cd app && pnpm nx build shell --skip-nx-cache 2>&1 | grep built')).toEqual({
      category: 'building',
      metadata: { tool: 'nx', target: 'build' },
    })
  })

  it('lets the earlier step win a tie', () => {
    expect(classified('npm test && pnpm nx test api').metadata).toEqual({ tool: 'npm' })
  })

  it('keeps redirection-like text inside a quoted commit message', () => {
    expect(classified('git add -A && git commit -m "feat: handle a > b and <Foo>"')).toEqual({
      category: 'shipping',
      metadata: { message: 'feat: handle a > b and <Foo>' },
    })
  })

  it('leaves a single command it already recognised exactly as before', () => {
    expect(classified('git commit -m "fix: a && b"')).toEqual({
      category: 'shipping',
      metadata: { message: 'fix: a && b' },
    })
  })
})

describe('nx rules', () => {
  it.each([
    ['nx build shell', 'building', 'build'],
    ['npx nx test api', 'testing', 'test'],
    ['pnpm nx e2e app-e2e', 'testing', 'e2e'],
    ['yarn nx run app:lint', 'linting', 'lint'],
    ['nx affected --target=build', 'building', 'build'],
    ['nx run-many --targets lint', 'linting', 'lint'],
    ['pnpm nx serve shell', 'running', 'serve'],
  ])('%s → %s', (command, expected, target) => {
    expect(classified(command)).toEqual({ category: expected, metadata: { tool: 'nx', target } })
  })

  it('leaves an unknown nx target unclassified', () => {
    expect(category('nx graph')).toBe('other')
  })

  it('classifies bare tsc as building', () => {
    expect(classified('tsc -p tsconfig.json --noEmit')).toEqual({
      category: 'building',
      metadata: { tool: 'tsc' },
    })
  })
})

describe('STEP_CATEGORY_PRIORITY', () => {
  it('puts outcomes before routine git work', () => {
    expect(STEP_CATEGORY_PRIORITY.indexOf('testing')).toBeLessThan(STEP_CATEGORY_PRIORITY.indexOf('versioning'))
    expect(STEP_CATEGORY_PRIORITY.indexOf('building')).toBeLessThan(STEP_CATEGORY_PRIORITY.indexOf('shipping'))
  })
})

describe('normalizeCommand — matchedStep, for capture', () => {
  it('names the step that set the category, as written', () => {
    expect(normalizeCommand('cd app && git -C ../web commit -m "x" && git status').matchedStep).toBe(
      'git -C ../web commit -m "x"'
    )
  })

  it('is the one work step when the whole command was recognised, not the `cd` before it', () => {
    expect(normalizeCommand('git commit -m "x" 2>&1 | tail -3').matchedStep).toBe('git commit -m "x" 2>&1 | tail -3')
  })

  it('keeps an agent heredoc message intact in the step', () => {
    const command = `git add . && git commit -m "$(cat <<'EOF'\nfeat: add y\n\nbody\nEOF\n)"`
    expect(normalizeCommand(command)).toMatchObject({ category: 'shipping', metadata: { message: 'feat: add y' } })
  })
})
