import { describe, it, expect } from 'vitest'
import { commitMessageOf } from '../../src/normalize/commit-message'

describe('commitMessageOf', () => {
  const subject = (step: string, original = step) => commitMessageOf(step, original)?.subject

  it.each([
    ['git commit -m "fix: x"', 'fix: x'],
    ["git commit -m 'it''s'", 'its'],
    ['git commit -m"short"', 'short'],
    ['git commit -am "both"', 'both'],
    ['git commit -sm "signed"', 'signed'],
    ['git commit --message="long form"', 'long form'],
    ['git commit --message "spaced"', 'spaced'],
    ['git commit -m "first" -m "second"', 'first'],
    ['git commit -m "say \\"hi\\""', 'say "hi"'],
    ['git commit -m wip --no-verify', 'wip'],
    ['git commit -m "$(cat <<\'EOF\'\nfeat: add x\n\nbody\nEOF\n)"', 'feat: add x'],
    ['git commit -m "$(cat <<-"END"\n\n  indented subject\nEND\n)"', 'indented subject'],
    ['git commit -m "$(cat <<\'EOF\'\nfix #12\nEOF\n)"', 'fix #12'],
    ['git commit --amend', null],
  ])('%s → %s', (step, expected) => {
    expect(subject(step)).toBe(expected)
  })

  it.each([
    ['<<EOF', 'git commit -F - <<EOF'],
    ["<<'EOF' (how agents write it)", "git commit -F - <<'EOF'"],
    ['<<"EOF"', 'git commit -F - <<"EOF"'],
  ])('reads -F - with %s from the original command, which steps no longer contain', (_form, step) => {
    const original = `git add -A && ${step}\nfeat: stdin\n\nmore\nEOF\ngit status`
    expect(subject(step, original)).toBe('feat: stdin')
  })

  it("takes the heredoc opened on the commit's own line when an earlier one used the same terminator", () => {
    const step = 'git commit -F - <<EOF'
    const original = `cat <<EOF > notes.txt\nnot the message\nEOF\n${step}\nthe real subject\nEOF`
    expect(subject(step, original)).toBe('the real subject')
  })

  it('leaves -F <file> for capture to read', () => {
    expect(commitMessageOf('git commit -F msg.txt', 'git commit -F msg.txt')).toEqual({
      subject: null,
      messageFile: 'msg.txt',
    })
    expect(commitMessageOf('git commit --file=m.txt', 'git commit --file=m.txt')).toEqual({
      subject: null,
      messageFile: 'm.txt',
    })
  })

  it('is null for anything but a commit', () => {
    expect(commitMessageOf('git push', 'git push')).toBeNull()
  })

  // Capture runs on every command an agent sends — an unterminated heredoc with a lot of whitespace once took
  // seconds (or never finished) under a single backtracking regex
  it('stays fast on an unterminated heredoc full of blank lines', () => {
    const step = `git commit -m "$(cat <<EOF${'\n'.repeat(20_000)}   x`
    const started = performance.now()
    expect(subject(step)).toBe(`$(cat <<EOF`)
    expect(performance.now() - started).toBeLessThan(200)
  })
})
