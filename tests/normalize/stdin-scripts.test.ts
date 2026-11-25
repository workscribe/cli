import { describe, it, expect } from 'vitest'
import {
  mentionsStdinInterpreter,
  runsScriptFromStdin,
  stdinScriptCount,
  stdinScriptInterpreters,
} from '../../src/normalize/stdin-scripts'

describe('runsScriptFromStdin', () => {
  it.each([
    'python3 -',
    'python -',
    'python3 -u -',
    'python3 -B -u -',
    'node -',
    'ruby -',
    'perl -',
    'bash -',
    'bash -s',
    'sh -s',
    'zsh -',
    'python3 -I -',
    'python3 -W ignore -',
    'python3 -X dev -',
    'python3 -Wignore -',
    'python3 -I -u -',
    'node --no-warnings -',
    'node --require ./setup.js -',
    'node -r ./setup.js -',
    'ruby -w -',
    'perl -w -',
    'bash -x -s',
    'bash -eu -s',
    'bash -xs',
  ])('is true for %s: the interpreter reads a script from standard input', (command) => {
    expect(runsScriptFromStdin(command)).toBe(true)
  })

  it.each([
    'python3 -c "print(1)"',
    'python3 -c -',
    'python3 x.py',
    'python3 -m http.server',
    'python3',
    'node -e "1"',
    'node x.js',
    'node --require ./a x.js -',
    'bash x.sh',
    'bash -c "ls"',
    'echo -',
    'cat -',
    'grep x -',
  ])('is false for %s', (command) => {
    expect(runsScriptFromStdin(command)).toBe(false)
  })
})

describe('stdinScriptInterpreters: a redirection gives the script', () => {
  it.each([
    ["python3 <<'EOF'\nEOF", 'python'],
    ["python <<'EOF'\nEOF", 'python'],
    ["node <<'EOF'\nEOF", 'node'],
    ["ruby <<'EOF'\nEOF", 'ruby'],
    ["perl <<'EOF'\nEOF", 'perl'],
    ['python3 < script.py', 'python'],
    ["python3 <<< 'print(1)'", 'python'],
    ["python3 -u <<'EOF'\nEOF", 'python'],
    ["cd app && python3 <<'EOF'\nEOF", 'python'],
    ["bash <<'EOF'\nEOF", 'bash'],
  ])('%j runs a script through %s', (command, interpreter) => {
    expect(stdinScriptInterpreters(command)).toEqual([interpreter])
  })

  it.each([
    'python3 x.py < input.txt',
    'python3 -c "print(1)" < input.txt',
    'python3 -m http.server < /dev/null',
    'python3 <(echo hi)',
    'python3',
    'cat <<EOF\nhello\nEOF',
    'git commit -F - <<EOF\nmessage\nEOF',
  ])('%j runs none: its input is data, or it names a script', (command) => {
    expect(stdinScriptInterpreters(command)).toEqual([])
  })
})

describe('mentionsStdinInterpreter', () => {
  it('is true for a command that names an interpreter a script could run in, and only then', () => {
    expect(mentionsStdinInterpreter('cd a && python3 - <<EOF')).toBe(true)
    expect(mentionsStdinInterpreter('cat a | node -')).toBe(true)
    expect(mentionsStdinInterpreter('bash -s')).toBe(true)
    expect(mentionsStdinInterpreter('npm test')).toBe(false)
    expect(mentionsStdinInterpreter('echo pythonic')).toBe(false)
  })
})

describe('stdinScriptCount', () => {
  it('counts the script of a heredoc as the stored command shows it, body gone', () => {
    expect(stdinScriptCount("python3 - <<'PYEOF'\nPYEOF")).toBe(1)
  })

  it('counts each script of a compound command', () => {
    const command = "python3 - <<'A'\nA\nnpx prettier --write src\npython3 - <<'B'\nB\ngrep -n x f"
    expect(stdinScriptCount(command)).toBe(2)
  })

  it('counts a script that is a later stage of a pipe', () => {
    expect(stdinScriptCount('cat a.py | python3 -')).toBe(1)
    expect(stdinScriptCount('curl -s url | node -')).toBe(1)
  })

  it('counts a script after a cd', () => {
    expect(stdinScriptCount("cd /repo && python3 - <<'EOF'\nEOF")).toBe(1)
  })

  it('counts nothing for commands that run no script from standard input', () => {
    expect(stdinScriptCount('python3 -c "print(1)"')).toBe(0)
    expect(stdinScriptCount('python3 x.py && node y.js')).toBe(0)
    expect(stdinScriptCount('npm test')).toBe(0)
    expect(stdinScriptCount('')).toBe(0)
  })

  it('reads a very long run of whitespace quickly', () => {
    const started = performance.now()
    stdinScriptCount(`python3 -${' '.repeat(200_000)}`)
    stdinScriptCount(' '.repeat(200_000))
    expect(performance.now() - started).toBeLessThan(250)
  })
})
