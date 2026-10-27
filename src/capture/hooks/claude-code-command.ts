// The command strings Workscribe writes into ~/.claude/settings.json, and how to read them back. Pure.
//
// Every command is guarded: when the binary (or the Node it's pinned to) is gone — say the package was removed
// without `workscribe uninstall` — the hook exits 0 silently instead of erroring on every prompt and tool call.
// `_hook` itself never exits non-zero, so the trailing `|| true` only ever hides a missing binary or a crash.

// Identifies a workscribe hook entry in any of its forms — legacy bare, pinned, guarded — since all contain it
export const HOOK_MARKER = '_hook --source claude-code'

const GUARD_SUFFIX = ' || true'
// The `test -x "<path>" && ` guards in front of a pinned command
const LEADING_PATH_GUARDS = /^(?:test -x "[^"]*" && )+/
const BARE_GUARD = 'command -v workscribe >/dev/null 2>&1 && '

/**
 * The command for one hook. Pinned (node and script paths known at install time) when possible, so it's immune to
 * PATH and Node-version drift; bare (`workscribe …`) otherwise. `args` follow the binary, e.g. `_hook --source …`.
 */
export function buildHookCommand(options: { nodePath: string; binaryPath: string | null; args: string }): string {
  if (!options.binaryPath) return `${BARE_GUARD}workscribe ${options.args}${GUARD_SUFFIX}`
  const { nodePath, binaryPath, args } = options
  return `test -x "${nodePath}" && test -x "${binaryPath}" && "${nodePath}" "${binaryPath}" ${args}${GUARD_SUFFIX}`
}

function withoutLeadingGuards(command: string): string {
  return command.trimStart().replace(LEADING_PATH_GUARDS, '')
}

/**
 * Pinned: invokes an absolute path (a Node interpreter) rather than the bare `workscribe` string — immune to
 * PATH/Node-version drift between install time and whatever environment the hook fires in.
 */
export function isPinnedCommand(command: string): boolean {
  const invocation = withoutLeadingGuards(command)
  return invocation.startsWith('"') || invocation.startsWith('/')
}

/** Guarded: does nothing, silently, when the binary is gone. */
export function isGuardedCommand(command: string): boolean {
  const trimmed = command.trim()
  const hasLeadingGuard = LEADING_PATH_GUARDS.test(trimmed) || trimmed.startsWith(BARE_GUARD)
  return hasLeadingGuard && trimmed.endsWith(GUARD_SUFFIX)
}

/** The Node interpreter a pinned command runs (`"<node>" "<workscribe>" …`), or null for a bare command. */
export function pinnedNodePath(command: string): string | null {
  return withoutLeadingGuards(command).match(/^"([^"]+)"/)?.[1] ?? null
}
