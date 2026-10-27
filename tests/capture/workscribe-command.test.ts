import { describe, it, expect } from 'vitest'
import { isWorkscribeOnlyCommand } from '../../src/capture/workscribe-command'

const SKILL_SAVE = [
  "workscribe sessions summary set --key 'api|2026-10-25T09:00:00.000Z' <<'EOF'",
  '## api (main) — 1h',
  "- Fixed the token refresh race; didn't touch the && fallback",
  'EOF',
].join('\n')

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

describe('isWorkscribeOnlyCommand — comments and unquoted heredocs', () => {
  it('ignores a # comment, so its text is not read as another step', () => {
    expect(isWorkscribeOnlyCommand('workscribe note "shipped" # then npm test')).toBe(true)
    expect(isWorkscribeOnlyCommand('workscribe note x #; npm test')).toBe(true)
  })

  it('counts $(…) inside an unquoted heredoc as real work, since the shell runs it', () => {
    expect(isWorkscribeOnlyCommand('workscribe note <<EOF\n$(npm test)\nEOF')).toBe(false)
  })

  it("still treats a quoted heredoc's body as plain text", () => {
    expect(isWorkscribeOnlyCommand("workscribe note <<'EOF'\n$(npm test)\nEOF")).toBe(true)
  })
})

describe('isWorkscribeOnlyCommand — loop headers', () => {
  it('counts a loop over a command as real work', () => {
    expect(isWorkscribeOnlyCommand('for f in $(npm test); do workscribe note $f; done')).toBe(false)
  })
})
