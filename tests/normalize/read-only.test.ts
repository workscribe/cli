import { describe, it, expect } from 'vitest'
import { isReadOnlyCommand, readOnlyMetadata } from '../../src/normalize/read-only'

describe('isReadOnlyCommand', () => {
  it.each([
    'git diff HEAD',
    'git log --oneline',
    'git show abc123',
    'git status',
    'git branch',
    'git -C ../web status',
    'git --no-pager log',
    'sed -n 1,5p f',
    "sed -n '/x/p' f",
    "sed -n '$=' f",
    'sed -n -e 1p f',
    'sed -ne 1p f',
    'sed -n 1p $f',
    'sed -nE 1p f',
    "sed -n '1p;3p' f",
    'python3 -c "print(1)"',
    'python -c "print(1)"',
    'python3 -u -c "print(1)"',
    'node -e "console.log(1)"',
    'node --eval "console.log(1)"',
    'ls',
    'ls -la src',
    'wc -l f',
    'grep x f',
    'egrep x f',
    'fgrep x f',
    'rg x',
    'ripgrep x',
    'ag x',
    'ack x',
    'cat f',
    'bat f',
    'less f',
    'more f',
    'head -5 f',
    'tail -f log',
    'find . -name "*.ts"',
  ])('%s only reads', (command) => {
    expect(isReadOnlyCommand(command)).toBe(true)
  })

  it.each([
    'git diff --output=x',
    'git log --output x',
    'git diff --ext-diff',
    'git show --textconv abc',
    'git branch -d x',
    'git branch new',
    'git branch -a',
    'git add .',
    'git commit -m x',
    'git',
    'sed s/a/b/ f',
    'sed -i s/a/b/ f',
    'sed -n -i 1p f',
    'sed -ni 1p f',
    'sed -n --in-place 1p f',
    "sed -n 'w out' f",
    "sed -n 'w p' f",
    "sed -n '1e touch p' f",
    "sed -n 's/a/b/w p' f",
    'sed -n -f x.sed f',
    'sed -n --file=x.sed f',
    'sed -n "$cmd" f',
    'python3 x.py',
    'python3 -m http.server',
    'python3',
    // a script from standard input: its body isn't stored, so nothing shows that it doesn't write files (WOR-215)
    "python3 - <<'EOF'\nprint(1)\nEOF",
    "python - <<'EOF'\nprint(1)\nEOF",
    "python3 <<'EOF'\nprint(1)\nEOF",
    'python3 < script.py',
    'python3 -I -',
    'python3 -u -',
    'cat a.py | python3 -',
    "python3 - <<'EOF'\nEOF\ngrep -n x f && ./deploy.sh",
    'node x.js',
    'node',
    'rg --pre ./x y',
    'rg --pre=./x y',
    'find . -delete',
    'find . -exec rm {} ;',
    'find . -execdir rm {} ;',
    'find . -fprint out',
    './deploy.sh',
    'constructor x',
  ])('%s is not read-only', (command) => {
    expect(isReadOnlyCommand(command)).toBe(false)
  })

  describe('compound commands', () => {
    it.each([
      'ls src && cat f',
      'git diff && git log',
      'cd app && git status',
      'd=x; cat $d/f | grep v',
      'for f in a b; do sed -n 1p $f; done',
      'cat f; echo "exit=$?"',
      'grep x f || true',
    ])('%s only reads', (command) => {
      expect(isReadOnlyCommand(command)).toBe(true)
    })

    it.each([
      'grep x f && ./deploy.sh',
      'python3 -c "print(1)" && ./deploy.sh',
      'git status && ./deploy.sh',
      'git log && npm test',
      'ls && rm f',
    ])('%s does more than read', (command) => {
      expect(isReadOnlyCommand(command)).toBe(false)
    })

    it.each(['cd app', 'echo hi', 'true', 'x=1'])('%s runs nothing, so it is not a read', (command) => {
      expect(isReadOnlyCommand(command)).toBe(false)
    })
  })

  describe('pipes', () => {
    it.each([
      'git log 2>&1 | head -5',
      'cat f | sort | uniq',
      'cat f | cut -d, -f1 | tr a b',
      'cat f | jq .x',
      'grep x f | wc -l',
      'cat f | uniq -c',
    ])('%s only reads', (command) => {
      expect(isReadOnlyCommand(command)).toBe(true)
    })

    it.each([
      'cat f | xargs rm',
      'cat f | sh',
      'grep x f | tee out',
      'git diff | ./x',
      'cat f | sort -o out',
      'cat f | sort -uo out',
      'cat f | sort --output=out',
      'cat f | uniq in out',
    ])('%s does more than read', (command) => {
      expect(isReadOnlyCommand(command)).toBe(false)
    })

    it('allows a filter only after the first stage', () => {
      expect(isReadOnlyCommand('sort f')).toBe(false)
      expect(isReadOnlyCommand('jq . f')).toBe(false)
    })
  })

  describe('redirections', () => {
    it.each(['git log 2>&1', 'grep x f 2>/dev/null', 'cat f > /dev/null', 'ls &>/dev/null', 'cat f >&2'])(
      '%s writes no file',
      (command) => {
        expect(isReadOnlyCommand(command)).toBe(true)
      }
    )

    it.each([
      'git diff > x.patch',
      'cat f >> g',
      'grep x f 2> err',
      'ls &> out',
      'cat > f <<EOF\nx\nEOF',
      'cat f; echo x > y',
      'cat f > "my file"',
    ])('%s writes a file', (command) => {
      expect(isReadOnlyCommand(command)).toBe(false)
    })

    it('ignores a `>` inside quotes', () => {
      expect(isReadOnlyCommand('grep "a > b" f')).toBe(true)
    })
  })

  describe('substitutions', () => {
    it.each([
      'f=$(find . -name x.ts)',
      'f=$(find . -name x.ts); sed -n 1p $f',
      'for f in $(ls); do cat $f; done',
      'cat $(ls)',
      'cat `ls`',
      "grep '$(' f",
      "grep '`' f",
    ])('%s only reads', (command) => {
      expect(isReadOnlyCommand(command)).toBe(true)
    })

    it.each([
      'cat $(rm x)',
      'cat `rm x`',
      'cat $(rm $(ls))',
      'cat <(rm x)',
      'python3 -c "print(\'$(x)\')"',
      'for f in $(npm test); do cat $f; done',
    ])('%s does more than read', (command) => {
      expect(isReadOnlyCommand(command)).toBe(false)
    })

    it('reads a substitution in a heredoc the shell expands', () => {
      expect(isReadOnlyCommand('cat <<EOF\n$(rm x)\nEOF')).toBe(false)
      expect(isReadOnlyCommand("cat <<'EOF'\n$(rm x)\nEOF")).toBe(true)
    })
  })
})

describe('readOnlyMetadata', () => {
  it.each([
    ['git log --oneline', { subcommand: 'log' }],
    ['git -C ../web status', { subcommand: 'status' }],
    ['cat f', { tool: 'cat' }],
    ['cd app && grep x f | wc -l', { tool: 'grep' }],
    ['f=$(find . -name x)', { tool: 'find' }],
    ['python3 -c "print(1)"', { tool: 'python3' }],
  ])('%s', (command, expected) => {
    expect(readOnlyMetadata(command)).toEqual(expected)
  })
})
