import { loadAIToolRegistry } from '../config/registry'
import { getActiveProfileRules } from '../profiles/loader'
import { debugLog } from '../utils/logger'
import { classifyCompound, UNCLASSIFIED } from './compound'
import { commitMessageOf } from './commit-message'
import { dependencyMetadata, extractPackages, INSTALL_WORDS, REMOVE_WORDS } from './dependency-metadata'
import { withoutGitGlobalOptions } from './git-invocation'
import { isReadOnlyCommand, READ_ONLY_CATEGORY, readOnlyMetadata } from './read-only'

export interface NormalizedEvent {
  category: string
  metadata: Record<string, unknown>
  /** The step that set the category, as written (or the whole command) — for capture, never stored */
  matchedStep?: string
}

/** What a rule can read besides the one-line command it matched: the step as written, and the whole command. */
interface RuleContext {
  /** The step with its line breaks and quoting — `-m "$(cat <<'EOF' …)"` survives here */
  raw: string
  /** The whole captured command, where heredoc bodies (`-F - <<EOF`) still are */
  original: string
}

interface Rule {
  match(cmd: string, context: RuleContext): NormalizedEvent | null
}

function makeRule(
  pattern: RegExp,
  category: string,
  extract: (match: RegExpMatchArray, cmd: string, context: RuleContext) => Record<string, unknown> = () => ({})
): Rule {
  return {
    match(cmd, context) {
      const m = cmd.match(pattern)
      if (!m) return null
      return { category, metadata: extract(m, cmd, context) }
    },
  }
}

/** A package-manager rule: `tool`'s packages after one of `commandWords`, with `action: 'remove'` for removals. */
function dependencyRule(pattern: RegExp, tool: string, commandWords: string[], action?: 'remove'): Rule {
  return makeRule(pattern, 'dependencies', (_match, command) => dependencyMetadata(tool, command, commandWords, action))
}

// Nx targets → categories: `nx build app`, `nx run app:test`, `nx run-many -t lint`, `nx affected --target=e2e`
const NX_TARGET_CATEGORIES: Record<string, string> = {
  build: 'building',
  test: 'testing',
  e2e: 'testing',
  lint: 'linting',
  serve: 'running',
  dev: 'running',
}
const NX_COMMAND =
  /^(?:(?:npx|pnpm|yarn|bunx)\s+)?nx\s+(?:(?:run-many|affected)\b.*?(?:-t|--targets?)[=\s]+([\w-]+)|run\s+[\w@./-]+:([\w-]+)|([\w-]+)\b)/

const nxRule: Rule = {
  match(cmd) {
    const match = cmd.match(NX_COMMAND)
    const target = match?.[1] ?? match?.[2] ?? match?.[3]
    const category = target ? NX_TARGET_CATEGORIES[target] : undefined
    return category ? { category, metadata: { tool: 'nx', target } } : null
  },
}

// Reads the step as written, because pipes and redirections decide whether a command only reads. First in the list, or
// `^git\s+` would take `git log`
const readOnlyRule: Rule = {
  match(_cmd, { raw }) {
    return isReadOnlyCommand(raw) ? { category: READ_ONLY_CATEGORY, metadata: readOnlyMetadata(raw) } : null
  },
}

const BASE_RULES: Rule[] = [
  readOnlyRule,

  // ─── Git operations ───────────────────────────────────────────────────────
  makeRule(/^git\s+commit\b/, 'shipping', (_m, _cmd, { raw, original }) => {
    // Read from the step as written, so quoting and multi-line heredoc messages survive (see git-invocation.ts)
    const commitMessage = commitMessageOf(raw, original)
    const message = commitMessage?.subject ?? null
    return commitMessage?.messageFile ? { message, messageFile: commitMessage.messageFile } : { message }
  }),

  makeRule(/^git\s+push\b/, 'shipping', (_m, cmd) => {
    // Flags (-u, --force, …) aren't the remote or branch: `git push -u origin main` → origin/main
    const positional = cmd
      .split(/\s+/)
      .slice(2)
      .filter((part) => !part.startsWith('-'))
    return { remote: positional[0] ?? 'origin', branch: positional[1] ?? null }
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
  dependencyRule(/^npm\s+(install|i|add)\b/, 'npm', INSTALL_WORDS),

  // `yarn workspace web add zod` — the workspace is the word after `workspace`
  makeRule(/^yarn\s+workspace\s+(\S+)\s+(add|remove)\b/, 'dependencies', (match, command) => ({
    ...dependencyMetadata('yarn', command, [match[2]], match[2] === 'remove' ? 'remove' : undefined),
    workspace: match[1],
  })),

  // `pnpm --filter web add zod`, `pnpm -F web add zod`, `pnpm -r add zod` — options before the subcommand
  makeRule(
    /^pnpm\s+(?:(?:--filter|-F)\s+\S+|--filter=\S+|-r|--recursive)\s+(add|install|i|remove|rm|uninstall|un)\b/,
    'dependencies',
    (match, command) =>
      REMOVE_WORDS.includes(match[1])
        ? dependencyMetadata('pnpm', command, REMOVE_WORDS, 'remove')
        : dependencyMetadata('pnpm', command, INSTALL_WORDS)
  ),

  // `yarn install` takes no packages; `pnpm install <pkg>` / `pnpm i <pkg>` adds them, like `add`
  dependencyRule(/^yarn\s+(install|add)\b/, 'yarn', ['add']),
  dependencyRule(/^pnpm\s+(install|i|add)\b/, 'pnpm', INSTALL_WORDS),
  dependencyRule(/^bun\s+(install|i|add)\b/, 'bun', INSTALL_WORDS),

  makeRule(/^pip\s+(install)\b/, 'dependencies', (_match, command) => ({
    tool: 'pip',
    packages: extractPackages(command, ['install']),
  })),

  makeRule(/^cargo\s+add\b/, 'dependencies', (_match, command) => ({
    tool: 'cargo',
    packages: extractPackages(command, ['add']),
  })),

  makeRule(/^(brew)\s+install\b/, 'dependencies', (_match, command) => ({
    tool: 'brew',
    packages: extractPackages(command, ['install']),
  })),

  makeRule(/^go\s+get\b/, 'dependencies', (_match, command) => ({
    tool: 'go',
    packages: extractPackages(command, ['get']),
  })),

  dependencyRule(/^npm\s+(uninstall|remove|rm|un)\b/, 'npm', REMOVE_WORDS, 'remove'),

  makeRule(/^(yarn|pnpm)\s+(remove|rm|uninstall|un)\b/, 'dependencies', (match, command) =>
    dependencyMetadata(match[1], command, REMOVE_WORDS, 'remove')
  ),

  dependencyRule(/^bun\s+(remove|rm)\b/, 'bun', REMOVE_WORDS, 'remove'),

  makeRule(/^pip\s+uninstall\b/, 'dependencies', (_match, command) => ({
    tool: 'pip',
    packages: extractPackages(command, ['uninstall']),
    action: 'remove',
  })),

  // Runtime version managers
  makeRule(/^nvm\b/, 'dependencies', (_m, cmd) => ({ tool: 'nvm', subcommand: cmd.split(/\s+/)[1] ?? null })),
  makeRule(/^(fnm|volta)\b/, 'dependencies', (m, cmd) => ({ tool: m[1], subcommand: cmd.split(/\s+/)[1] ?? null })),
  makeRule(/^(rbenv|pyenv|asdf)\b/, 'dependencies', (m, cmd) => ({
    tool: m[1],
    subcommand: cmd.split(/\s+/)[1] ?? null,
  })),

  // ─── Nx (before the package-manager rules, which would read `pnpm nx` as `pnpm`) ─
  nxRule,

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
  makeRule(/^(?:npx\s+)?tsc\b/, 'building', () => ({ tool: 'tsc' })),
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
]

function aiToolRules(): Rule[] {
  return loadAIToolRegistry().flatMap((entry) => {
    try {
      return [makeRule(new RegExp(entry.pattern), 'ai_session', () => ({ tool: entry.tool }))]
    } catch {
      debugLog('registry', `Skipping tool "${entry.tool}" — invalid pattern: ${entry.pattern}`)
      return []
    }
  })
}

export function buildRules(profileRules: Array<{ match(cmd: string): NormalizedEvent | null }> = []): Rule[] {
  return [...BASE_RULES, ...profileRules, ...aiToolRules()]
}

// Built on first use, not at import: the active profiles come from the config and profile files, and
// importing this module (via capture, or the database's migrations) shouldn't read either
let activeRules: Rule[] | null = null

function getRules(): Rule[] {
  activeRules ??= buildRules(getActiveProfileRules())
  return activeRules
}

function matchRules(command: string, context: RuleContext): NormalizedEvent {
  // git's own options (`-C <dir>`, `-c k=v`, `--work-tree=…`) are dropped, so the rules see `git <subcommand> …`
  const flattened = withoutGitGlobalOptions(command.trim()).replace(/\s+/g, ' ')
  for (const rule of getRules()) {
    const result = rule.match(flattened, context)
    if (result) return result
  }
  return UNCLASSIFIED
}

/**
 * Classifies a captured command — compound ones by their most telling step (see `./compound`). `matchedStep` says
 * which step that was, as written, so capture can tell which repo a `git -C …` step worked in.
 */
export function normalizeCommand(command: string): NormalizedEvent {
  return classifyCompound(command, (simple, raw) => matchRules(simple, { raw, original: command }))
}
