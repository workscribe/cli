export interface NormalizedEvent {
  category: string
  metadata: Record<string, unknown>
}

interface Rule {
  // Returns metadata if command matches, null otherwise
  match(cmd: string): NormalizedEvent | null
}

function makeRule(
  pattern: RegExp,
  category: string,
  extract: (match: RegExpMatchArray, cmd: string) => Record<string, unknown> = () => ({})
): Rule {
  return {
    match(cmd) {
      const m = cmd.match(pattern)
      if (!m) return null
      return { category, metadata: extract(m, cmd) }
    },
  }
}

// Extract package names from install commands like: npm install foo bar
function extractPackages(cmd: string, afterKeyword: string): string[] {
  const idx = cmd.indexOf(afterKeyword)
  if (idx === -1) return []
  return cmd
    .slice(idx + afterKeyword.length)
    .trim()
    .split(/\s+/)
    .filter((p) => p && !p.startsWith('-'))
}

export const RULES: Rule[] = [
  // ─── Git operations ───────────────────────────────────────────────────────
  makeRule(/^git\s+commit\b/, 'code_commit', (_m, cmd) => {
    const msgMatch = cmd.match(/-m\s+["']?([^"']+)["']?/)
    return { message: msgMatch ? msgMatch[1].trim() : null }
  }),

  makeRule(/^git\s+push\b/, 'code_push', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { remote: parts[2] ?? 'origin', branch: parts[3] ?? null }
  }),

  makeRule(/^git\s+(pull|fetch)\b/, 'code_pull', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { subcommand: parts[1], remote: parts[2] ?? 'origin' }
  }),

  makeRule(/^git\s+(checkout|switch)\b/, 'branch_switch', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    const branch = parts.find((p) => !p.startsWith('-') && p !== 'git' && p !== parts[1])
    return { branch: branch ?? null }
  }),

  makeRule(/^git\s+(merge|rebase)\b/, 'code_merge', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { subcommand: parts[1], target: parts[2] ?? null }
  }),

  makeRule(/^git\s+stash\b/, 'code_stash', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { subcommand: parts[2] ?? 'push' }
  }),

  makeRule(/^git\s+/, 'git_other', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { subcommand: parts[1] ?? null }
  }),

  // ─── Package managers — install ───────────────────────────────────────────
  makeRule(/^npm\s+(install|i|add)\b/, 'dependency_install', (_m, cmd) => ({
    tool: 'npm',
    packages: extractPackages(cmd, cmd.includes('install') ? 'install' : cmd.includes(' i ') ? ' i ' : 'add'),
  })),

  makeRule(/^(yarn|pnpm)\s+(install|add)\b/, 'dependency_install', (m, cmd) => ({
    tool: m[1],
    packages: extractPackages(cmd, 'add'),
  })),

  makeRule(/^pip\s+(install)\b/, 'dependency_install', (_m, cmd) => ({
    tool: 'pip',
    packages: extractPackages(cmd, 'install'),
  })),

  makeRule(/^cargo\s+add\b/, 'dependency_install', (_m, cmd) => ({
    tool: 'cargo',
    packages: extractPackages(cmd, 'add'),
  })),

  makeRule(/^(brew)\s+install\b/, 'dependency_install', (_m, cmd) => ({
    tool: 'brew',
    packages: extractPackages(cmd, 'install'),
  })),

  makeRule(/^go\s+get\b/, 'dependency_install', (_m, cmd) => ({
    tool: 'go',
    packages: extractPackages(cmd, 'get'),
  })),

  // ─── Package managers — remove ────────────────────────────────────────────
  makeRule(/^npm\s+(uninstall|remove|rm)\b/, 'dependency_remove', (_m, cmd) => ({
    tool: 'npm',
    packages: extractPackages(cmd, cmd.split(/\s+/)[1]),
  })),

  makeRule(/^(yarn|pnpm)\s+remove\b/, 'dependency_remove', (m, cmd) => ({
    tool: m[1],
    packages: extractPackages(cmd, 'remove'),
  })),

  makeRule(/^pip\s+uninstall\b/, 'dependency_remove', (_m, cmd) => ({
    tool: 'pip',
    packages: extractPackages(cmd, 'uninstall'),
  })),

  // ─── Tests ────────────────────────────────────────────────────────────────
  makeRule(/^(npm\s+(test|run\s+test)|yarn\s+test|pnpm\s+test)\b/, 'test_run', () => ({ tool: 'npm' })),
  makeRule(/^(jest|vitest)\b/, 'test_run', (m) => ({ tool: m[1] })),
  makeRule(/^pytest\b/, 'test_run', () => ({ tool: 'pytest' })),
  makeRule(/^go\s+test\b/, 'test_run', () => ({ tool: 'go' })),
  makeRule(/^cargo\s+test\b/, 'test_run', () => ({ tool: 'cargo' })),
  makeRule(/^rspec\b/, 'test_run', () => ({ tool: 'rspec' })),
  makeRule(/^(php\s+)?phpunit\b/, 'test_run', () => ({ tool: 'phpunit' })),

  // ─── Build ────────────────────────────────────────────────────────────────
  makeRule(/^npm\s+run\s+build\b/, 'build', () => ({ tool: 'npm' })),
  makeRule(/^(yarn|pnpm)\s+build\b/, 'build', (m) => ({ tool: m[1] })),
  makeRule(/^(make|gmake)\b/, 'build', (m) => ({ tool: m[1] })),
  makeRule(/^cargo\s+build\b/, 'build', () => ({ tool: 'cargo' })),
  makeRule(/^go\s+build\b/, 'build', () => ({ tool: 'go' })),
  makeRule(/^docker\s+build\b/, 'build', () => ({ tool: 'docker' })),
  makeRule(/^(mvn|gradle)\b/, 'build', (m) => ({ tool: m[1] })),

  // ─── Dev server ───────────────────────────────────────────────────────────
  makeRule(/^npm\s+run\s+(dev|start|serve)\b/, 'server_run', (_m, cmd) => ({
    tool: 'npm',
    script: cmd.split(/\s+/)[2],
  })),
  makeRule(/^(yarn|pnpm)\s+(dev|start)\b/, 'server_run', (m) => ({ tool: m[1], script: m[2] })),
  makeRule(/^python\s+.*manage\.py\s+runserver\b/, 'server_run', () => ({ tool: 'django' })),

  // ─── Infrastructure ───────────────────────────────────────────────────────
  makeRule(/^ssh\b/, 'infrastructure', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { tool: 'ssh', target: parts[parts.length - 1] }
  }),

  makeRule(/^kubectl\b/, 'infrastructure', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { tool: 'kubectl', subcommand: parts[1] ?? null }
  }),

  makeRule(/^(helm|terraform|pulumi)\b/, 'infrastructure', (m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { tool: m[1], subcommand: parts[1] ?? null }
  }),

  makeRule(/^docker\s+(run|compose|ps|stop|start|rm|exec)\b/, 'infrastructure', (m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { tool: 'docker', subcommand: parts[1] }
  }),

  makeRule(/^(aws|gcloud|az)\b/, 'infrastructure', (m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { tool: m[1], subcommand: parts[1] ?? null }
  }),

  // ─── Scripts ──────────────────────────────────────────────────────────────
  makeRule(/^(bash|sh|zsh|fish)\s+\S+/, 'script_run', (m) => ({ shell: m[1] })),
  makeRule(/^node\s+\S+\.(?:js|mjs|cjs)\b/, 'script_run', () => ({ runtime: 'node' })),
  makeRule(/^python3?\s+\S+\.py\b/, 'script_run', () => ({ runtime: 'python' })),

  // ─── Environment ──────────────────────────────────────────────────────────
  makeRule(/^export\s+\w+=/, 'environment', (_m, cmd) => {
    const varName = cmd.match(/^export\s+(\w+)=/)?.[1] ?? null
    return { variable: varName }
  }),
  makeRule(/^source\s+/, 'environment', () => ({})),

  // ─── npm scripts (generic) ────────────────────────────────────────────────
  makeRule(/^npm\s+run\s+\S+/, 'script_run', (_m, cmd) => ({
    tool: 'npm',
    script: cmd.split(/\s+/)[2],
  })),
]

export function normalizeCommand(command: string): NormalizedEvent {
  const trimmed = command.trim().replace(/\s+/g, ' ')

  for (const rule of RULES) {
    const result = rule.match(trimmed)
    if (result) return result
  }

  return { category: 'other', metadata: {} }
}
