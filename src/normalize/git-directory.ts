// The folder a captured command's work happened in — the repo to credit it to. Pure: paths are only resolved, never
// looked at on disk.
import path from 'path'
import { type GitInvocation, parseGitInvocation } from './git-invocation'

/** A literal directory that can be followed — not `~`, `$VAR`, `-` or a substitution, which only the shell expands. */
function isLiteralDirectory(directory: string | null | undefined): directory is string {
  return typeof directory === 'string' && directory !== '' && directory !== '-' && !/[~$`]/.test(directory)
}

/**
 * The directory a git invocation works in, from `base`: its `-C` chain (each relative to the one before), then its
 * `--work-tree` relative to that — or, without either, the repo a `--git-dir …/.git` belongs to.
 */
export function gitDirectoryOf(invocation: GitInvocation, base: string): string {
  if (!invocation.directories.every(isLiteralDirectory)) return base
  const directory = invocation.directories.reduce((current, next) => path.resolve(current, next), base)
  if (invocation.workTree !== null) {
    return isLiteralDirectory(invocation.workTree) ? path.resolve(directory, invocation.workTree) : base
  }
  const { gitDir } = invocation
  if (invocation.directories.length === 0 && isLiteralDirectory(gitDir) && path.basename(gitDir) === '.git') {
    return path.dirname(path.resolve(directory, gitDir))
  }
  return directory
}

/**
 * Where a captured command's work happened: `cwd`, moved by the matched step's own git options (`-C`,
 * `--work-tree`, `--git-dir`). A `cd` before the step is never followed: every source reports `cwd` as where the
 * shell ended up — the shell hook's `$PWD`, and Claude Code's `cwd`, which keeps a `cd` inside the project (checked
 * against Claude Code 2.1.311). Following it again would apply it twice.
 */
export function effectiveDirectory(options: { matchedStep: string; cwd: string }): string {
  const invocation = parseGitInvocation(options.matchedStep)
  return invocation ? gitDirectoryOf(invocation, options.cwd) : options.cwd
}
