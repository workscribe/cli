import fs from 'fs'
import path from 'path'

// The shell hook stores `--cwd "$PWD"`: the folder as you reached it, through any symlink (a symlinked `~/code`, or
// macOS's `/tmp` → `/private/tmp`). Node's `process.cwd()` and `git rev-parse --show-toplevel` give the resolved
// path. These helpers let `note` and `context` see paths the way capture stored them.

function realPath(target: string): string | null {
  try {
    return fs.realpathSync(target)
  } catch {
    return null // the folder is gone, or never existed
  }
}

/** The path with symlinks resolved, or as given if it doesn't exist (any more). */
export function resolvedPath(target: string): string {
  return realPath(target) ?? target
}

/** The folder you're in, as you reached it: `$PWD` when it's the same folder as `process.cwd()`, else that. */
export function currentDirectory(where = { pwd: process.env.PWD, cwd: process.cwd() }): string {
  if (where.pwd && realPath(where.pwd) === realPath(where.cwd)) return where.pwd
  return where.cwd
}

/**
 * The repo root in every form a stored event's `cwd` may use: git's resolved `root`, and the same folder as reached
 * from `cwd` — so a repo opened through a symlink still matches its own activity.
 */
export function rootForms(cwd: string, root: string): string[] {
  const resolvedCwd = realPath(cwd)
  if (!resolvedCwd) return [root]
  const reached = path.resolve(cwd, path.relative(resolvedCwd, root))
  return [...new Set([root, reached])]
}

/** `target` relative to `root` — `''` for the root itself — or null when it's outside it. Pure: compares paths only. */
export function relativeInside(root: string, target: string): string | null {
  const relative = path.relative(root, target)
  const isOutside = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)
  return isOutside ? null : relative
}

/**
 * The file's path relative to the repo root, or null when it isn't inside it. The root is tried in each form the
 * file's own folder reaches it by, so a file opened through a symlink still matches.
 */
export function pathInsideRoot(filePath: string, root: string): string | null {
  for (const form of rootForms(path.dirname(filePath), root)) {
    const relative = relativeInside(form, filePath)
    if (relative) return relative
  }
  return null
}
