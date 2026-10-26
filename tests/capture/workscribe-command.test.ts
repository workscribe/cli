import { describe, it, expect } from 'vitest'
import { isWorkscribeOnlyCommand, splitSteps, stripHeredocBodies } from '../../src/capture/workscribe-command'

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
})

describe('splitSteps and background jobs', () => {
  it('splits on a background & but not on redirections', () => {
    expect(splitSteps('npm run dev & npm test 2>&1 &> log.txt >&2')).toEqual([
      'npm run dev',
      'npm test 2>&1 &> log.txt >&2',
    ])
  })
})

describe('isWorkscribeOnlyCommand', () => {
  it.each([
    ['a bare call', 'workscribe sessions --json'],
    ['a call after cd', 'cd ~/api && workscribe sessions --json'],
    ['a pipe into workscribe', 'echo "## api" | workscribe sessions summary set --key k'],
    ['workscribe piped onwards', 'workscribe sessions --json | jq .'],
    ['printf piped into workscribe', "printf '%s' '## api' | workscribe sessions summary set --key k"],
    ['workscribe with its output redirected', 'workscribe sessions --json > /tmp/sessions.json 2>&1'],
    ['$(…) inside single quotes, which the shell does not run', "workscribe note 'costs $(nothing)'"],
    ['workscribe with || true', 'workscribe sessions --json 2>/dev/null || true'],
    ['workscribe then echoing its exit code', 'workscribe sessions --json; echo "exit=$?"'],
    ['workscribe then cd back', 'workscribe sessions --json && cd -'],
    ['workscribe with a no-op : step', 'workscribe sessions --json || :'],
    ['<(…) inside double quotes, which is plain text', 'workscribe note "arrow x=>(y) fix"'],
    ['a heredoc whose body has apostrophes, ; and &&', SKILL_SAVE],
  ])('is true for %s', (_case, command) => {
    expect(isWorkscribeOnlyCommand(command)).toBe(true)
  })

  it.each([
    ['real work before workscribe', 'npm test && workscribe note "tests pass"'],
    ['real work after a heredoc', `${SKILL_SAVE}\nnpm test`],
    ['a different command that starts with the same letters', 'workscribe-like --flag'],
    ['workscribe only inside a quoted argument', 'echo "a && workscribe"'],
    ['only cd', 'cd ~/api'],
    ['only glue', 'cd ~/api && echo done || true'],
    ['real work hidden in a trailing echo', 'workscribe sessions --json; echo "$(npm test)"'],
    ['real work piped from a trailing echo', 'workscribe sessions --json; echo x | npm test'],
    ['an ordinary command', 'npm test'],
    ['real work piped into workscribe', 'npm test | workscribe note done'],
    [
      'real work with a redirect piped into workscribe',
      'npm run deploy 2>&1 | workscribe sessions summary set --key k',
    ],
    ['real work started in the background after workscribe', 'cd api && workscribe sessions --json & npm run deploy'],
    ['real work inside $(…) piped into workscribe', 'echo "Tests: $(npm test | tail -1)" | workscribe note done'],
    ['real work inside $(…) as a workscribe argument', 'cd repo && workscribe note "$(npm test)"'],
    ['real work inside backticks', 'workscribe note x `npm test`'],
    ['a quoted << that is not a heredoc', 'cd x && workscribe note "a<<b"\nnpm test'],
    ['an escaped apostrophe followed by real work', "cd a && workscribe note it\\'s && npm test"],
    ['real work inside a leading cd', 'cd "$(npm test)" && workscribe note x'],
    ['real work piped from a leading cd', 'cd x | npm test && workscribe note done'],
    ['real work in a process substitution', 'workscribe sessions summary set --key k < <(npm test)'],
    ['an escaped << that is not a heredoc', 'workscribe note \\<<EOF\nnpm test'],
  ])('is false for %s', (_case, command) => {
    expect(isWorkscribeOnlyCommand(command)).toBe(false)
  })
})
