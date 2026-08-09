import { loadAIToolRegistry } from '../config/registry'
import { debugLog } from '../utils/logger'

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
    .filter((part) => part && !part.startsWith('-'))
}

export const RULES: Rule[] = [
  // ─── Git operations ───────────────────────────────────────────────────────
  makeRule(/^git\s+commit\b/, 'shipping', (_m, cmd) => {
    const msgMatch = cmd.match(/-m\s+["']?([^"']+)["']?/)
    return { message: msgMatch ? msgMatch[1].trim() : null }
  }),

  makeRule(/^git\s+push\b/, 'shipping', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { remote: parts[2] ?? 'origin', branch: parts[3] ?? null }
  }),

  makeRule(/^git\s+(pull|fetch)\b/, 'versioning', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { subcommand: parts[1], remote: parts[2] ?? 'origin' }
  }),

  makeRule(/^git\s+(checkout|switch)\b/, 'versioning', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    const branch = parts.find((part) => !part.startsWith('-') && part !== 'git' && part !== parts[1])
    return { branch: branch ?? null }
  }),

  makeRule(/^git\s+(merge|rebase)\b/, 'shipping', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { subcommand: parts[1], target: parts[2] ?? null }
  }),

  makeRule(/^git\s+stash\b/, 'versioning', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { subcommand: parts[2] ?? 'push' }
  }),

  makeRule(/^git\s+/, 'versioning', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { subcommand: parts[1] ?? null }
  }),

  // ─── Releasing ────────────────────────────────────────────────────────────
  makeRule(/^npm\s+publish\b/, 'releasing', () => ({ tool: 'npm' })),
  makeRule(/^cargo\s+publish\b/, 'releasing', () => ({ tool: 'cargo' })),
  makeRule(/^gem\s+push\b/, 'releasing', () => ({ tool: 'gem' })),
  makeRule(/^docker\s+push\b/, 'releasing', (_m, cmd) => ({ tool: 'docker', image: cmd.split(/\s+/)[2] ?? null })),
  makeRule(/^gh\s+release\b/, 'releasing', (_m, cmd) => ({ tool: 'gh', subcommand: cmd.split(/\s+/)[2] ?? null })),
  makeRule(/^fly\s+(deploy|launch)\b/, 'releasing', (match) => ({ tool: 'fly', subcommand: match[1] })),
  makeRule(/^vercel\s+(deploy|build|--prod)\b/, 'releasing', () => ({ tool: 'vercel' })),
  makeRule(/^netlify\s+deploy\b/, 'releasing', () => ({ tool: 'netlify' })),
  makeRule(/^railway\s+up\b/, 'releasing', () => ({ tool: 'railway' })),
  makeRule(/^wrangler\s+deploy\b/, 'releasing', () => ({ tool: 'wrangler' })),

  // ─── Dependencies ─────────────────────────────────────────────────────────
  makeRule(/^npm\s+(install|i|add)\b/, 'dependencies', (_m, cmd) => ({
    tool: 'npm',
    packages: extractPackages(cmd, cmd.includes('install') ? 'install' : cmd.includes(' i ') ? ' i ' : 'add'),
  })),

  makeRule(/^(yarn|pnpm)\s+(install|add)\b/, 'dependencies', (m, cmd) => ({
    tool: m[1],
    packages: extractPackages(cmd, 'add'),
  })),

  makeRule(/^bun\s+(install|add)\b/, 'dependencies', (_m, cmd) => ({
    tool: 'bun',
    packages: extractPackages(cmd, 'add'),
  })),

  makeRule(/^pip\s+(install)\b/, 'dependencies', (_m, cmd) => ({
    tool: 'pip',
    packages: extractPackages(cmd, 'install'),
  })),

  makeRule(/^cargo\s+add\b/, 'dependencies', (_m, cmd) => ({
    tool: 'cargo',
    packages: extractPackages(cmd, 'add'),
  })),

  makeRule(/^(brew)\s+install\b/, 'dependencies', (_m, cmd) => ({
    tool: 'brew',
    packages: extractPackages(cmd, 'install'),
  })),

  makeRule(/^go\s+get\b/, 'dependencies', (_m, cmd) => ({
    tool: 'go',
    packages: extractPackages(cmd, 'get'),
  })),

  makeRule(/^npm\s+(uninstall|remove|rm)\b/, 'dependencies', (_m, cmd) => ({
    tool: 'npm',
    packages: extractPackages(cmd, cmd.split(/\s+/)[1]),
  })),

  makeRule(/^(yarn|pnpm)\s+remove\b/, 'dependencies', (m, cmd) => ({
    tool: m[1],
    packages: extractPackages(cmd, 'remove'),
  })),

  makeRule(/^bun\s+remove\b/, 'dependencies', (_m, cmd) => ({
    tool: 'bun',
    packages: extractPackages(cmd, 'remove'),
  })),

  makeRule(/^pip\s+uninstall\b/, 'dependencies', (_m, cmd) => ({
    tool: 'pip',
    packages: extractPackages(cmd, 'uninstall'),
  })),

  // Runtime version managers
  makeRule(/^nvm\b/, 'dependencies', (_m, cmd) => ({ tool: 'nvm', subcommand: cmd.split(/\s+/)[1] ?? null })),
  makeRule(/^(fnm|volta)\b/, 'dependencies', (m, cmd) => ({ tool: m[1], subcommand: cmd.split(/\s+/)[1] ?? null })),
  makeRule(/^(rbenv|pyenv|asdf)\b/, 'dependencies', (m, cmd) => ({
    tool: m[1],
    subcommand: cmd.split(/\s+/)[1] ?? null,
  })),

  // ─── Tests ────────────────────────────────────────────────────────────────
  makeRule(/^npm\s+(test|run\s+test)\b/, 'testing', () => ({ tool: 'npm' })),
  makeRule(/^yarn\s+test\b/, 'testing', () => ({ tool: 'yarn' })),
  makeRule(/^pnpm\s+test\b/, 'testing', () => ({ tool: 'pnpm' })),
  makeRule(/^bun\s+test\b/, 'testing', () => ({ tool: 'bun' })),
  makeRule(/^(jest|vitest)\b/, 'testing', (match) => ({ tool: match[1] })),
  makeRule(/^pytest\b/, 'testing', () => ({ tool: 'pytest' })),
  makeRule(/^go\s+test\b/, 'testing', () => ({ tool: 'go' })),
  makeRule(/^cargo\s+test\b/, 'testing', () => ({ tool: 'cargo' })),
  makeRule(/^rspec\b/, 'testing', () => ({ tool: 'rspec' })),
  makeRule(/^(php\s+)?phpunit\b/, 'testing', () => ({ tool: 'phpunit' })),

  // ─── Build ────────────────────────────────────────────────────────────────
  makeRule(/^npm\s+run\s+build\b/, 'building', () => ({ tool: 'npm' })),
  makeRule(/^(yarn|pnpm)\s+build\b/, 'building', (match) => ({ tool: match[1] })),
  makeRule(/^bun\s+run\s+build\b/, 'building', () => ({ tool: 'bun' })),
  makeRule(/^(make|gmake)\b/, 'building', (match) => ({ tool: match[1] })),
  makeRule(/^cargo\s+build\b/, 'building', () => ({ tool: 'cargo' })),
  makeRule(/^go\s+build\b/, 'building', () => ({ tool: 'go' })),
  makeRule(/^docker\s+build\b/, 'building', () => ({ tool: 'docker' })),
  makeRule(/^(mvn|gradle)\b/, 'building', (match) => ({ tool: match[1] })),

  // ─── Dev server / running ─────────────────────────────────────────────────
  makeRule(/^npm\s+run\s+(dev|start|serve)\b/, 'running', (_m, cmd) => ({
    tool: 'npm',
    script: cmd.split(/\s+/)[2],
  })),
  makeRule(/^(yarn|pnpm)\s+(dev|start)\b/, 'running', (match) => ({ tool: match[1], script: match[2] })),
  makeRule(/^bun\s+run\s+(dev|start|serve)\b/, 'running', (_m, cmd) => ({
    tool: 'bun',
    script: cmd.split(/\s+/)[2],
  })),
  makeRule(/^python\s+.*manage\.py\s+runserver\b/, 'running', () => ({ tool: 'django' })),

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

  makeRule(/^docker\s+(run|compose|ps|stop|start|rm|exec)\b/, 'infrastructure', (_m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { tool: 'docker', subcommand: parts[1] }
  }),

  makeRule(/^(aws|gcloud|az)\b/, 'infrastructure', (m, cmd) => {
    const parts = cmd.split(/\s+/)
    return { tool: m[1], subcommand: parts[1] ?? null }
  }),

  // ─── Database ─────────────────────────────────────────────────────────────
  makeRule(/^(psql|pgcli)\b/, 'database', (m) => ({ tool: m[1] })),
  makeRule(/^(mysql|mycli)\b/, 'database', (m) => ({ tool: m[1] })),
  makeRule(/^sqlite3\b/, 'database', () => ({ tool: 'sqlite3' })),
  makeRule(/^(mongosh|mongo)\b/, 'database', (m) => ({ tool: m[1] })),
  makeRule(/^redis-cli\b/, 'database', () => ({ tool: 'redis-cli' })),

  // ─── npx ─────────────────────────────────────────────────────────────────
  makeRule(/^npx\s+(jest|vitest|mocha|ava|tap)\b/, 'testing', (_m, cmd) => ({
    tool: cmd.split(/\s+/)[1],
  })),
  makeRule(/^npx\s+tsc\b/, 'building', () => ({ tool: 'tsc' })),
  makeRule(/^npx\s+(eslint|tslint|biome)\b/, 'linting', (_m, cmd) => ({
    tool: cmd.split(/\s+/)[1],
  })),
  makeRule(/^npx\s+(prettier|dprint)\b/, 'linting', (_m, cmd) => ({
    tool: cmd.split(/\s+/)[1],
  })),
  makeRule(/^npx\s+\S+/, 'running', (_m, cmd) => ({
    tool: cmd.split(/\s+/)[1],
  })),

  // ─── Scripts ──────────────────────────────────────────────────────────────
  makeRule(/^(bash|sh|zsh|fish)\s+\S+/, 'running', (match) => ({ shell: match[1] })),
  makeRule(/^node\s+\S+\.(?:js|mjs|cjs)\b/, 'running', () => ({ runtime: 'node' })),
  makeRule(/^python3?\s+\S+\.py\b/, 'running', () => ({ runtime: 'python' })),

  // ─── Linting / code quality ───────────────────────────────────────────────
  makeRule(/^(eslint|tslint|biome)\b/, 'linting', (match) => ({ tool: match[1] })),
  makeRule(/^(prettier|dprint)\b/, 'linting', (match) => ({ tool: match[1] })),

  // ─── generic run scripts ──────────────────────────────────────────────────
  makeRule(/^npm\s+run\s+\S+/, 'running', (_m, cmd) => ({
    tool: 'npm',
    script: cmd.split(/\s+/)[2],
  })),

  makeRule(/^bun\s+run\s+\S+/, 'running', (_m, cmd) => ({
    tool: 'bun',
    script: cmd.split(/\s+/)[2],
  })),

  // ─── Code search ─────────────────────────────────────────────────────────
  makeRule(/^(grep|egrep|fgrep)\b/, 'exploring', (match) => ({ tool: match[1] })),
  makeRule(/^(rg|ag|ack|ripgrep)\b/, 'exploring', (match) => ({ tool: match[1] })),
  makeRule(/^find\s/, 'exploring', () => ({ tool: 'find' })),

  // ─── Code read ────────────────────────────────────────────────────────────
  makeRule(/^(cat|bat|less|more)\s+\S+/, 'exploring', (match) => ({ tool: match[1] })),
  makeRule(/^(head|tail)\b/, 'exploring', (match) => ({ tool: match[1] })),

  // ─── File operations ──────────────────────────────────────────────────────
  makeRule(/^(cp|rsync)\b/, 'files', (match) => ({ tool: match[1] })),
  makeRule(/^(mv)\b/, 'files', () => ({ tool: 'mv' })),
  makeRule(/^(rm|rmdir)\b/, 'files', (match) => ({ tool: match[1] })),
  makeRule(/^(mkdir|touch|ln)\b/, 'files', (match) => ({ tool: match[1] })),
  makeRule(/^(chmod|chown|chgrp)\b/, 'files', (match) => ({ tool: match[1] })),

  // ─── Environment ──────────────────────────────────────────────────────────
  makeRule(/^export\s+\w+=/, 'files', (_m, cmd) => {
    const varName = cmd.match(/^export\s+(\w+)=/)?.[1] ?? null
    return { variable: varName }
  }),
  makeRule(/^source\s+/, 'files', () => ({})),

  // ─── AI terminal tools (registry-driven) ─────────────────────────────────
  ...loadAIToolRegistry().flatMap((entry) => {
    try {
      return [makeRule(new RegExp(entry.pattern), 'ai_session', () => ({ tool: entry.tool }))]
    } catch {
      debugLog('registry', `Skipping tool "${entry.tool}" — invalid pattern: ${entry.pattern}`)
      return []
    }
  }),
]

export function normalizeCommand(command: string): NormalizedEvent {
  let trimmed = command.trim().replace(/\s+/g, ' ')

  // Strip `git -C <path>` prefix so rules match regardless of working directory flag
  trimmed = trimmed.replace(/^(git)\s+-C\s+\S+\s+/, '$1 ')

  for (const rule of RULES) {
    const result = rule.match(trimmed)
    if (result) return result
  }

  return { category: 'other', metadata: {} }
}
