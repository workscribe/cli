import { describe, it, expect } from 'vitest'
import {
  commandSteps,
  isGlueStep,
  simpleCommandOf,
  splitSteps,
  stripHeredocBodies,
} from '../../src/capture/command-steps'

const SKILL_SAVE = [
  "workscribe sessions summary set --key 'api|2026-10-25T09:00:00.000Z' <<'EOF'",
  '## api (main) — 1h',
  "- Fixed the token refresh race; didn't touch the && fallback",
  'EOF',
].join('\n')

describe('stripHeredocBodies', () => {
  it('keeps the opening line and drops the body up to the terminator', () => {
    expect(stripHeredocBodies(SKILL_SAVE)).toBe(
      "workscribe sessions summary set --key 'api|2026-10-25T09:00:00.000Z' <<'EOF'"
    )
  })

  it('keeps lines after the terminator', () => {
    expect(stripHeredocBodies(`${SKILL_SAVE}\nnpm test`).split('\n')).toHaveLength(2)
  })

  it('does not treat a <<< here-string as a heredoc', () => {
    expect(stripHeredocBodies('cat <<<EOF\nnpm test')).toBe('cat <<<EOF\nnpm test')
  })

  it('keeps the commands an unquoted heredoc runs, without the text around them', () => {
    expect(stripHeredocBodies('cat <<EOF\nplain text\nran $(npm test) and `date`\nEOF\nls')).toBe(
      'cat <<EOF\nnpm test\ndate\nls'
    )
  })

  it('does not let an apostrophe next to a substitution in a heredoc swallow later steps', () => {
    expect(commandSteps("git commit -F - <<EOF\nBuilt at $(date), don't merge\nEOF\nnpm test")).toEqual([
      'git commit -F - <<EOF',
      'date',
      'npm test',
    ])
  })

  it('drops the same lines from a quoted heredoc, which the shell leaves alone', () => {
    expect(stripHeredocBodies("cat <<'EOF'\n$(npm test)\nEOF")).toBe("cat <<'EOF'")
  })

  it('ignores a heredoc opener inside a comment', () => {
    expect(stripHeredocBodies('# see <<EOF for details\nnpm test')).toBe('# see <<EOF for details\nnpm test')
  })
})

describe('splitSteps', () => {
  it('splits on &&, ||, ; and newlines but not inside quotes', () => {
    expect(splitSteps('cd api && npm test || echo "a && b"; ls\npwd')).toEqual([
      'cd api',
      'npm test',
      'echo "a && b"',
      'ls',
      'pwd',
    ])
  })

  it('splits on a background & but not on redirections', () => {
    expect(splitSteps('npm run dev & npm test 2>&1 &> log.txt >&2')).toEqual([
      'npm run dev',
      'npm test 2>&1 &> log.txt >&2',
    ])
  })
})

// Shapes from real Claude Code sessions (paths shortened)
describe('commandSteps', () => {
  it.each([
    [
      'a cd prefix and a pipe',
      'cd app && pnpm nx test shell 2>&1 | tail -40; npx tsc --noEmit',
      ['cd app', 'pnpm nx test shell 2>&1 | tail -40', 'npx tsc --noEmit'],
    ],
    [
      'a plain assignment before the work',
      'd=node_modules/x; cat $d/package.json | grep v',
      ['cat $d/package.json | grep v'],
    ],
    [
      'a subshell group',
      '(cd streambox && pnpm exec tsc -p a.json --noEmit; echo "tsc=$?")',
      ['cd streambox', 'pnpm exec tsc -p a.json --noEmit', 'echo "tsc=$?"'],
    ],
    ['a for loop', 'for f in a b; do sed -n 1p $f; done', ['sed -n 1p $f']],
    ['an if', 'if npm test; then echo ok; else echo bad; fi', ['npm test', 'echo ok', 'echo bad']],
    ['a brace group', '{ npm test; npm run build; }', ['npm test', 'npm run build']],
    ['a comment', 'npm test # fast\n# a whole-line comment\nnpm run build', ['npm test', 'npm run build']],
  ])('splits %s into the commands it runs', (_name, command, expected) => {
    expect(commandSteps(command)).toEqual(expected)
  })

  it('keeps an assignment that runs a command', () => {
    expect(commandSteps('f=$(find . -name x.ts); sed -n 1p $f')).toEqual(['f=$(find . -name x.ts)', 'sed -n 1p $f'])
  })

  it.each([
    ['$# (argument count)', 'echo $#'],
    ['${#x} (string length)', 'echo ${#x}'],
    ['a # inside a word', 'curl http://host/a#b'],
    ['a quoted #', 'echo "# not a comment"'],
  ])('does not treat %s as a comment', (_name, command) => {
    expect(commandSteps(command)).toEqual([command])
  })
})

describe('simpleCommandOf', () => {
  it.each([
    ['leading assignments', 'NODE_ENV=test DEBUG=1 npm test', 'npm test'],
    ['everything after the first pipe', 'pnpm nx build shell 2>&1 | grep -E "built in"', 'pnpm nx build shell'],
    ['redirections', 'npx tsc --noEmit 2>/dev/null > out.txt', 'npx tsc --noEmit'],
    [
      'a pnpm exec runner',
      'pnpm exec tsc -p movies/tsconfig.app.json --noEmit',
      'npx tsc -p movies/tsconfig.app.json --noEmit',
    ],
    ['a pnpm dlx runner', 'pnpm dlx vitest run', 'npx vitest run'],
    ['the command an assignment captures', 'f=$(find . -name "*.conf")', 'find . -name "*.conf"'],
  ])('removes %s', (_name, step, expected) => {
    expect(simpleCommandOf(step)).toBe(expected)
  })
})

describe('isGlueStep', () => {
  it.each(['cd app', 'true', ':', 'echo "exit=$?"', 'printf done'])('treats %s as glue', (step) => {
    expect(isGlueStep(step)).toBe(true)
  })

  it.each(['npm test', 'echo $(npm test)', 'echo x | npm test'])('treats %s as work', (step) => {
    expect(isGlueStep(step)).toBe(false)
  })
})

describe('commandSteps — review fixes', () => {
  it('keeps tracking quotes correctly after a comment with an apostrophe', () => {
    expect(commandSteps("# Let's check\nls\n# then run tests; npm test")).toEqual(['ls'])
  })

  it('keeps a loop header that runs a command', () => {
    expect(commandSteps('for f in $(npm test); do echo $f; done')).toEqual(['for f in $(npm test)', 'echo $f'])
  })

  it('does not let a comment mentioning a heredoc swallow the rest', () => {
    expect(commandSteps('# see <<EOF\nnpm test')).toEqual(['npm test'])
  })
})

describe('simpleCommandOf — quoted redirection characters', () => {
  it('keeps > and < inside quotes and removes real redirections', () => {
    expect(simpleCommandOf('git commit -m "feat: a > b and <Foo>" 2>&1')).toBe('git commit -m "feat: a > b and <Foo>"')
  })
})
