import { describe, it, expect } from 'vitest'
import { reportedExitCode } from '../../src/normalize/exit-evidence'

// Real tools and one that doesn't exist: the answer must come from the shape of the command, never from the tool
const TOOLS = [
  'vitest run',
  'pytest -q',
  'cargo test',
  'go test ./...',
  'mvn test',
  'gradle test',
  'dotnet test',
  'make test',
  'terraform validate',
  'frobnicate test',
]

type Shape = (tool: string) => string

// The exit code is the tool's: it ran alone, or the whole line passes only when it did
const TRUSTED_SHAPES: Record<string, Shape> = {
  plain: (tool) => tool,
  'with stderr merged': (tool) => `${tool} 2>&1`,
  'after a cd': (tool) => `cd app && ${tool}`,
  'after a cd and a semicolon': (tool) => `cd app; ${tool}`,
  'before an && echo': (tool) => `${tool} && echo ok`,
  'in an && chain': (tool) => `${tool} && ${tool} --coverage`,
  'with a pipe inside quotes': (tool) => `${tool} --grep "a|b"`,
  'with a here-doc whose body has shell syntax in it': (tool) => `${tool} <<'EOF'\nhello | world; $(x) &\nEOF`,
  'with a semicolon inside quotes': (tool) => `${tool} -m "done; ok"`,
  'with an || inside quotes': (tool) => `${tool} -t 'a || b'`,
}

// The shell reports another command's exit code, so a 0 says nothing about the tool
const MASKED_SHAPES: Record<string, Shape> = {
  'piped to tail': (tool) => `${tool} | tail`,
  'piped to tail with stderr merged': (tool) => `${tool} 2>&1 | tail -20`,
  'piped to tee': (tool) => `${tool} | tee out.log`,
  'piped to grep': (tool) => `${tool} | grep FAIL`,
  'piped after a cd': (tool) => `cd app && ${tool} | tail`,
  'followed by || true': (tool) => `${tool} || true`,
  'followed by || :': (tool) => `${tool} || :`,
  'followed by || exit 0': (tool) => `${tool} || exit 0`,
  'followed by || echo': (tool) => `${tool} || echo failed`,
  'followed by || another run': (tool) => `${tool} || ${tool} --retry`,
  'followed by an echo of its status': (tool) => `${tool}; echo "exit=$?"`,
  'followed by true': (tool) => `${tool}; true`,
  'followed by another command': (tool) => `${tool}; git status`,
  'followed by a cd': (tool) => `cd app && ${tool}; cd ..`,
  "after an agent's empty here-doc, piped": (tool) => `cd app && python3 - <<'EOF'\nEOF\n${tool} 2>&1 | tail -25`,
  'run in the background': (tool) => `${tool} &`,
  'run in the background, then waited for': (tool) => `${tool} & wait`,
  'on a line of its own with a later line': (tool) => `${tool}\ngit status`,
}

// Shapes this rule can't read, or that make the exit code another command's (or its opposite): a 0 is not trusted
const UNREAD_SHAPES: Record<string, Shape> = {
  'with pipefail set': (tool) => `set -o pipefail; ${tool} | tail`,
  'with errexit set': (tool) => `set -e; ${tool}; echo done`,
  'in a subshell': (tool) => `(${tool}) | tail`,
  negated: (tool) => `! ${tool}`,
  'negated in a list': (tool) => `! ${tool} && echo failed`,
  'as the condition of an if': (tool) => `if ${tool}; then echo ok; fi`,
  'as the test of a while': (tool) => `while ${tool}; do sleep 1; done`,
  'in a command substitution': (tool) => `out=$(${tool}); echo "$out"`,
  'in backticks': (tool) => `out=\`${tool}\`; echo "$out"`,
  'in a brace group': (tool) => `{ ${tool}; } | tail`,
  'under time': (tool) => `time ${tool} | tail`,
  'under xargs': (tool) => `echo a | xargs ${tool}`,
  'under nohup': (tool) => `nohup ${tool} > out.log &`,
  'under env': (tool) => `env CI=1 ${tool} | tail`,
}

function reported(command: string, category = 'testing', exitCode: number | null = 0, tool: string | null = null) {
  return reportedExitCode({ command, category, exitCode, tool })
}

/** The word the rules store as the tool: the first word of the command (`cargo test` is stored as `cargo`). */
const toolWordOf = (tool: string): string => tool.split(' ')[0]

function shapeCases(shapes: Record<string, Shape>): [string, string, Shape][] {
  return TOOLS.flatMap((tool) =>
    Object.entries(shapes).map(([name, shape]): [string, string, Shape] => [tool, name, shape])
  )
}

describe.each([
  ['with the stored tool', (tool: string) => toolWordOf(tool)],
  ['with no stored tool', () => null],
])('reportedExitCode %s', (_label, storedTool) => {
  it.each(shapeCases(TRUSTED_SHAPES))('keeps the 0 of %s %s', (tool, _name, shape) => {
    expect(reported(shape(tool), 'testing', 0, storedTool(tool))).toBe(0)
  })

  it.each(shapeCases(MASKED_SHAPES))('says nothing about the exit of %s %s', (tool, _name, shape) => {
    expect(reported(shape(tool), 'testing', 0, storedTool(tool))).toBeNull()
  })

  it.each(shapeCases(UNREAD_SHAPES))('gives no credit to the 0 of %s %s', (tool, _name, shape) => {
    expect(reported(shape(tool), 'testing', 0, storedTool(tool))).toBeNull()
  })
})

describe('reportedExitCode', () => {
  it.each(['testing', 'building', 'linting'])('applies to %s', (category) => {
    expect(reported('npm test | tail', category)).toBeNull()
  })

  it.each(['running', 'shipping', 'versioning', 'dependencies', 'other', 'ai_session'])(
    'never changes a %s event, whatever its shape',
    (category) => {
      expect(reported('git push | tail', category)).toBe(0)
    }
  )

  it.each(Object.entries(MASKED_SHAPES))('never turns a failure into anything else when it is %s', (_name, shape) => {
    expect(reported(shape('vitest run'), 'testing', 1)).toBe(1)
    expect(reported(shape('vitest run'), 'testing', 127)).toBe(127)
  })

  it('leaves an unknown exit code unknown', () => {
    expect(reported('vitest run | tail', 'testing', null)).toBeNull()
  })

  it.each(Object.entries({ ...TRUSTED_SHAPES, ...MASKED_SHAPES, ...UNREAD_SHAPES }))(
    'gives the same answer for every tool when it is %s',
    (_name, shape) => {
      const answers = new Set(TOOLS.map((tool) => reported(shape(tool))))

      expect(answers.size).toBe(1)
    }
  )

  describe('finding the run by its stored tool', () => {
    const TOOL_RUNS: Record<string, Shape> = {
      'after an unrelated pipeline': (tool) => `git diff | head; ${tool}`,
      'after an unrelated pipeline joined by &&': (tool) => `git log | head && ${tool}`,
      'before an unrelated pipeline joined by &&': (tool) => `${tool} && git log | head`,
      'as the last stage of a pipeline': (tool) => `cat input.txt | ${tool}`,
      'as the last stage after a here-doc': (tool) => `cat <<EOF | ${tool}\nbody\nEOF`,
    }
    const OTHER_COMMANDS_EXIT: Record<string, Shape> = {
      'before an unrelated pipeline': (tool) => `${tool}; git diff | head`,
      'before an unrelated command': (tool) => `${tool}\ngit status`,
      'in the middle of a pipeline': (tool) => `${tool} | tee a | tail`,
      'in the first stage of a pipeline': (tool) => `${tool} --reporter=json | jq .`,
      'run twice, one of them piped': (tool) => `${tool} && ${tool} --retry | tail`,
    }

    it.each(shapeCases(TOOL_RUNS))('keeps the 0 of %s %s when the tool is known', (tool, _name, shape) => {
      expect(reported(shape(tool), 'testing', 0, toolWordOf(tool))).toBe(0)
    })

    it.each(shapeCases(OTHER_COMMANDS_EXIT))('says nothing about %s %s', (tool, _name, shape) => {
      expect(reported(shape(tool), 'testing', 0, toolWordOf(tool))).toBeNull()
    })

    it.each(shapeCases(TOOL_RUNS))('reads %s %s as a whole when the tool is not known', (tool, _name, shape) => {
      const command = shape(tool)

      expect(reported(command, 'testing', 0, null)).toBe(reported(command, 'testing', 0, 'a-tool-not-in-the-line'))
    })

    it('reads the whole line when the stored tool is not in it', () => {
      expect(reported('git diff | head; make test', 'testing', 0, 'cargo')).toBeNull()
    })

    it('does not mistake a longer word for the tool', () => {
      expect(reported('vitest-coverage-report | tail; vitest run', 'testing', 0, 'vitest')).toBe(0)
    })

    it('finds a tool whose name has regex characters in it', () => {
      expect(reported('c++ -o a a.cc | tail; ./a', 'testing', 0, 'c++')).toBeNull()
    })
  })

  it('reads a truncated command as it is, without failing', () => {
    expect(reported('vitest run | ta')).toBeNull()
    expect(reported('vitest run ||')).toBe(0)
    expect(reported('')).toBe(0)
  })

  it('keeps the 0 of a plain command that has a substitution or a variable in its arguments', () => {
    expect(reported('npx eslint $(git diff --name-only)')).toBe(0)
    expect(reported('npx eslint ${FILES}')).toBe(0)
  })

  it('does not take a file named after the tool for the tool', () => {
    expect(reported('ls vitest.config.ts && npm test | tail', 'testing', 0, 'vitest')).toBeNull()
  })
})
