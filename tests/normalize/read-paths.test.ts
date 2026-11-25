import { describe, it, expect } from 'vitest'
import { MAX_STORED_COMMAND_LENGTH } from '../../src/capture/command-steps'
import { readPathsOf } from '../../src/normalize/read-paths'

const REPO = '/work/app'
const inRepo = { cwd: REPO, repoRoot: REPO }

describe('readPathsOf: what each tool reads', () => {
  it.each([
    ['cat src/a.ts', ['src/a.ts']],
    ['cat src/a.ts src/b.ts', ['src/a.ts', 'src/b.ts']],
    ['head -n 20 src/a.ts', ['src/a.ts']],
    ['head -20 src/a.ts', ['src/a.ts']],
    ['tail -c 100 src/a.ts', ['src/a.ts']],
    ['wc -l src/a.ts', ['src/a.ts']],
    ['less src/a.ts', ['src/a.ts']],
    ["sed -n '1,20p' src/a.ts", ['src/a.ts']],
    ['sed -n -e 1p src/a.ts', ['src/a.ts']],
    ['grep pattern src/a.ts', ['src/a.ts']],
    ['grep -rn pattern src tests', ['src', 'tests']],
    ['grep -e one -e two src/a.ts', ['src/a.ts']],
    ['grep -A 3 -B 2 pattern src/a.ts', ['src/a.ts']],
    ['rg --glob "*.ts" pattern src', ['src']],
    ['rg -t ts pattern src/db', ['src/db']],
    ['ls src', ['src']],
    ['ls -la src tests', ['src', 'tests']],
    ['find src -name "*.ts"', ['src']],
    ['find src tests -type f', ['src', 'tests']],
    ['git diff main..HEAD -- src/a.ts docs', ['src/a.ts', 'docs']],
    ['git log --oneline -- src', ['src']],
    ['git -C packages/web diff -- a.ts', ['packages/web/a.ts']],
  ])('%s', (command, expected) => {
    expect(readPathsOf(command, inRepo)).toEqual(expected)
  })

  it.each([
    'grep pattern',
    'rg pattern',
    'ls',
    'find . -name x',
    'git status',
    'git diff HEAD',
    'git log --oneline',
    "python3 - <<'EOF'\nprint(1)\nEOF",
    'node -e "console.log(1)"',
    'cat -',
    'cat /dev/null',
  ])('names no path for %s', (command) => {
    expect(readPathsOf(command, inRepo)).toEqual([])
  })
})

describe('readPathsOf: shell syntax', () => {
  it('reads each step of a compound command', () => {
    expect(readPathsOf('cat a.md && ls src; grep x tests/a.test.ts', inRepo)).toEqual([
      'a.md',
      'src',
      'tests/a.test.ts',
    ])
  })

  it('reads only the first stage of a pipe: later stages take their input from it', () => {
    expect(readPathsOf('cat a.md | head -5', inRepo)).toEqual(['a.md'])
    expect(readPathsOf('git diff -- a.md | grep x docs', inRepo)).toEqual(['a.md'])
  })

  it('reads quoted paths with spaces as one path', () => {
    expect(readPathsOf('cat "my notes/a b.md"', inRepo)).toEqual(['my notes/a b.md'])
  })

  it('follows a cd step for the paths after it', () => {
    expect(readPathsOf('cd src/db && cat a.ts', inRepo)).toEqual(['src/db/a.ts'])
    expect(readPathsOf('cd src/db; cd ..; cat a.ts', inRepo)).toEqual(['src/a.ts'])
  })

  it('skips paths the shell would expand, and anything it cannot read', () => {
    expect(readPathsOf('cat $FILE', inRepo)).toEqual([])
    expect(readPathsOf('cat $(ls src)', inRepo)).toEqual([])
    expect(readPathsOf('cat `which x`', inRepo)).toEqual([])
    expect(readPathsOf('cat ~/notes.md', inRepo)).toEqual([])
  })

  it('cuts a glob at its first pattern segment', () => {
    expect(readPathsOf('cat tests/fixtures/*/stop.json', inRepo)).toEqual(['tests/fixtures'])
    expect(readPathsOf('cat *.md', inRepo)).toEqual([])
  })

  it('names nothing for a command that writes', () => {
    expect(readPathsOf('cat a.md > b.md', inRepo)).toEqual([])
  })

  it('names each path once and at most twenty', () => {
    expect(readPathsOf('cat a.md a.md b.md', inRepo)).toEqual(['a.md', 'b.md'])
    const many = Array.from({ length: 30 }, (_, index) => `f${index}.ts`)
    expect(readPathsOf(`cat ${many.join(' ')}`, inRepo)).toHaveLength(20)
  })
})

describe('readPathsOf: relative to the repository', () => {
  it('resolves a relative path against the folder the command ran in', () => {
    const context = { cwd: '/work/app/src', repoRoot: REPO }
    expect(readPathsOf('cat db/x.ts', context)).toEqual(['src/db/x.ts'])
    expect(readPathsOf('cat ../docs/a.md', context)).toEqual(['docs/a.md'])
  })

  it('makes an absolute path inside the repository relative to it', () => {
    expect(readPathsOf('cat /work/app/src/a.ts', inRepo)).toEqual(['src/a.ts'])
  })

  it('drops a path outside the repository, absolute or reached through ..', () => {
    expect(readPathsOf('cat /etc/hosts', inRepo)).toEqual([])
    expect(readPathsOf('cat ../other/a.ts', inRepo)).toEqual([])
    expect(readPathsOf('cat /work/app-two/a.ts', inRepo)).toEqual([])
  })

  it('drops the repository root itself', () => {
    expect(readPathsOf('ls /work/app', inRepo)).toEqual([])
  })
})

describe('readPathsOf: what is never named', () => {
  it.each([
    'node_modules/pkg/index.js',
    'dist/main.js',
    'build/out.js',
    'coverage/lcov.info',
    '.git/config',
    '.next/server.js',
    'src/__pycache__/a.pyc',
    '.env',
    '.env.local',
    'certs/server.pem',
    'certs/server.key',
    '.ssh/id_rsa',
    'config/credentials.json',
    'config/secrets.yml',
    'secrets/prod.txt',
    '.ssh/id_ed25519',
    'keys/id_ecdsa.pub',
    '.npmrc',
    '.netrc',
    '.pgpass',
    '.htpasswd',
    'certs/store.p12',
    'certs/store.pfx',
    'app.keystore',
    'auth/token.txt',
    'auth/passwords.csv',
    '.ssh/config',
    '.aws/config',
    '.gnupg/pubring.kbx',
    '.kube/config',
    '.docker/config.json',
    'infra/terraform.tfvars',
    'infra/state.tfstate',
    'deploy/kubeconfig',
    'deploy/service-account.json',
    'config/api_key.json',
    'config/apikey.txt',
    '.boto',
    '.s3cfg',
    '.my.cnf',
    '.vault-pass',
    'config/auth.json',
    'Node_Modules/pkg/index.js',
    'DIST/main.js',
  ])('never names %s', (denied) => {
    expect(readPathsOf(`cat ${denied}`, inRepo)).toEqual([])
    expect(readPathsOf(`cat ${denied} src/a.ts`, inRepo)).toEqual(['src/a.ts'])
  })
})

describe('readPathsOf: a stored command that was cut', () => {
  it('ignores its last path, which the bound may have cut short', () => {
    const padding = ` # ${'x'.repeat(MAX_STORED_COMMAND_LENGTH)}`
    const cutCommand = `cat src/a.ts src/b.ts\ncat src/long${padding}`.slice(0, MAX_STORED_COMMAND_LENGTH)
    expect(cutCommand).toHaveLength(MAX_STORED_COMMAND_LENGTH)
    expect(readPathsOf(cutCommand, inRepo)).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('keeps every path of a command under the bound', () => {
    expect(readPathsOf('cat src/a.ts src/b.ts', inRepo)).toEqual(['src/a.ts', 'src/b.ts'])
  })
})

describe('readPathsOf: speed', () => {
  it('reads a very long run of whitespace quickly', () => {
    const started = performance.now()
    readPathsOf(`cat src/a.ts${' '.repeat(200_000)}src/b.ts`, inRepo)
    readPathsOf(' '.repeat(200_000), inRepo)
    expect(performance.now() - started).toBeLessThan(250)
  })
})

describe('readPathsOf: options it does not know', () => {
  it('names nothing when an option it does not know could hide the search pattern among the words', () => {
    expect(readPathsOf('rg --color never foo src', inRepo)).toEqual([])
    expect(readPathsOf('grep --unheard-of foo src', inRepo)).toEqual([])
    expect(readPathsOf('grep -Z9 foo src', inRepo)).toEqual([])
  })

  it('names nothing for another tool whose option it does not know', () => {
    expect(readPathsOf('ls --time-style long src', inRepo)).toEqual([])
    expect(readPathsOf('bat --unheard-of f.ts', inRepo)).toEqual([])
  })

  it('never takes the value of an option it knows for a path or for the pattern', () => {
    expect(readPathsOf('rg -j 4 secret-pattern src', inRepo)).toEqual(['src'])
    expect(readPathsOf('ls -I pattern src', inRepo)).toEqual(['src'])
    expect(readPathsOf('bat -l ts f.ts', inRepo)).toEqual(['f.ts'])
    expect(readPathsOf('bat --style plain f.ts', inRepo)).toEqual(['f.ts'])
    expect(readPathsOf('grep -A3 pattern src', inRepo)).toEqual(['src'])
    expect(readPathsOf('grep -m 5 pattern src', inRepo)).toEqual(['src'])
    expect(readPathsOf('grep --include=*.ts pattern src', inRepo)).toEqual(['src'])
    expect(readPathsOf('grep -rnE pattern src', inRepo)).toEqual(['src'])
  })

  it('reads the words after -e or -f as paths, since they gave the pattern', () => {
    expect(readPathsOf('grep -rne pattern src tests', inRepo)).toEqual(['src', 'tests'])
    expect(readPathsOf('grep --regexp=pattern src', inRepo)).toEqual(['src'])
  })
})

describe('readPathsOf: cd with options', () => {
  it('moves to the folder, not to its option', () => {
    expect(readPathsOf('cd -P src && cat a.ts', inRepo)).toEqual(['src/a.ts'])
    expect(readPathsOf('cd -- src && cat a.ts', inRepo)).toEqual(['src/a.ts'])
    expect(readPathsOf('cd -L -- src && cat a.ts', inRepo)).toEqual(['src/a.ts'])
  })

  it('no longer knows the folder after cd -, so names no relative path after it', () => {
    expect(readPathsOf('cd - && cat a.ts', inRepo)).toEqual([])
    expect(readPathsOf('cd - && cat /work/app/a.ts', inRepo)).toEqual(['a.ts'])
  })
})

describe('readPathsOf: words that are not paths', () => {
  it('never names git pathspec magic, which says what to leave out', () => {
    expect(readPathsOf("git diff -- . ':!package-lock.json'", inRepo)).toEqual([])
    expect(readPathsOf("git diff HEAD -- src ':(exclude).env'", inRepo)).toEqual(['src'])
    expect(readPathsOf("git log -- ':(glob)**/*.ts' docs", inRepo)).toEqual(['docs'])
  })

  it('takes the first word after -- as the pattern, even when it looks like an option', () => {
    expect(readPathsOf('grep -r -- -fix src', inRepo)).toEqual(['src'])
    expect(readPathsOf('grep -r -- -e src', inRepo)).toEqual(['src'])
  })

  it('does not take a word after -- for the option that gives the pattern', () => {
    expect(readPathsOf('grep -r -e pattern -- src', inRepo)).toEqual(['src'])
  })

  it('never takes a + option of less, more, head or tail for a file', () => {
    expect(readPathsOf('tail +5 src/a.ts', inRepo)).toEqual(['src/a.ts'])
    expect(readPathsOf('less +/needle src/a.ts', inRepo)).toEqual(['src/a.ts'])
    expect(readPathsOf('more +3 src/a.ts', inRepo)).toEqual(['src/a.ts'])
    expect(readPathsOf('head +1 src/a.ts', inRepo)).toEqual(['src/a.ts'])
  })
})

describe('readPathsOf: cd inside a group', () => {
  it('no longer knows the folder after a cd it cannot be sure reaches the next step', () => {
    expect(readPathsOf('(cd sub && ls); cat a.ts', inRepo)).toEqual([])
    expect(readPathsOf('{ cd sub; ls; }; cat a.ts', inRepo)).toEqual([])
  })

  it('still names what came before the group, and absolute paths after it', () => {
    expect(readPathsOf('cat a.ts; (cd sub && ls)', inRepo)).toEqual(['a.ts'])
    expect(readPathsOf('(cd sub && ls); cat /work/app/b.ts', inRepo)).toEqual(['b.ts'])
  })

  it('does not take a quoted bracket for a group', () => {
    expect(readPathsOf('cd src && cat "a (1).ts"', inRepo)).toEqual(['src/a (1).ts'])
  })
})

describe('readPathsOf: a command cut just under the bound', () => {
  it('ignores the last path of a command within a few characters of the bound, which a trimmed end can leave short', () => {
    const near = `cat src/a.ts src/b.ts\n# ${'x'.repeat(MAX_STORED_COMMAND_LENGTH - 44)}\ncat src/c`
    expect(near.length).toBeGreaterThanOrEqual(MAX_STORED_COMMAND_LENGTH - 16)
    expect(near.length).toBeLessThan(MAX_STORED_COMMAND_LENGTH)
    expect(readPathsOf(near, inRepo)).toEqual(['src/a.ts', 'src/b.ts'])
  })
})
