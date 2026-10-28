// A `git commit`'s message, from however it was given: `-m`, `-am`, `--message=`, `-F <file>`, `-F -` with a heredoc,
// or the `-m "$(cat <<'EOF' … EOF)"` form coding agents use. Pure: a message file is only named, for capture to read.
import { heredocBodies } from '../capture/command-steps'
import { isOutsideQuotes } from '../capture/shell-syntax'
import { parseGitInvocation } from './git-invocation'

// The first line of `$(cat <<'EOF'` — anchored to one line, so there's nothing for the engine to backtrack over
const SUBSTITUTION_OPENER = /^\$\(\s*cat\s*<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1\s*$/
// A heredoc opener (`<<TAG`, `<<-'TAG'`), not a `<<<` here-string
const HEREDOC_OPENER = /(?<!<)<<(?!<)-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g

/** What a `git commit` says about its message: the subject line, or the file it reads it from. */
export interface CommitMessage {
  subject: string | null
  /** `-F <file>` — read by capture, which can check the file safely; never stored */
  messageFile?: string
}

/** The first non-empty line — what `git log --format=%s` calls the subject. */
function firstLineOf(text: string | null | undefined): string | null {
  const line = text
    ?.split('\n')
    .map((part) => part.trim())
    .find((part) => part !== '')
  return line || null
}

/** A `$(cat <<'TAG' … TAG)` value's body, found line by line — or null if the value isn't one. */
function substitutionHeredocBody(value: string): string | null {
  const lines = value.split('\n')
  const terminator = lines[0]?.match(SUBSTITUTION_OPENER)?.[2]
  if (!terminator) return null
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === terminator)
  return end === -1 ? null : lines.slice(1, end).join('\n')
}

function messageFromValue(value: string | undefined): CommitMessage {
  if (value === undefined) return { subject: null }
  return { subject: firstLineOf(substitutionHeredocBody(value) ?? value) }
}

/** The heredoc tag a `-F -` step reads from — quoted or not — if its opener sits outside quotes. */
function inputHeredocTag(step: string): string | null {
  for (const match of step.matchAll(HEREDOC_OPENER)) {
    if (isOutsideQuotes(step, match.index)) return match[2]
  }
  return null
}

function messageFromFile(file: string | undefined, step: string, original: string): CommitMessage {
  if (file === undefined) return { subject: null }
  if (file !== '-') return { subject: null, messageFile: file }
  // `-F -` reads standard input: a heredoc whose body is gone from the step, so it's taken from the whole command —
  // the one opened on this step's line, in case an earlier heredoc used the same terminator
  const tag = inputHeredocTag(step)
  if (!tag) return { subject: null }
  const stepLine = step.split('\n')[0].trim()
  const heredocs = heredocBodies(original).filter(({ terminator }) => terminator === tag)
  const heredoc = heredocs.find(({ openerLine }) => openerLine.includes(stepLine)) ?? heredocs[0]
  return { subject: firstLineOf(heredoc?.body) }
}

/**
 * A `git commit` step's message: `-m`, `-m<msg>`, `--message[=]`, short flags ending in `m` (`-am`), `-F`/`--file`
 * (a file, or `-` for a heredoc). The first message given is the subject. Null if the step isn't a commit.
 * `original` is the whole captured command, where heredoc bodies for `-F -` still are.
 */
export function commitMessageOf(step: string, original: string): CommitMessage | null {
  const invocation = parseGitInvocation(step)
  if (invocation?.subcommand !== 'commit') return null
  const args = invocation.args.map(({ word }) => word)
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    const next = args[index + 1]
    if (arg === '--') break
    if (arg === '-m' || arg === '--message') return messageFromValue(next)
    if (arg.startsWith('--message=')) return messageFromValue(arg.slice('--message='.length))
    if (arg === '-F' || arg === '--file') return messageFromFile(next, step, original)
    if (arg.startsWith('--file=')) return messageFromFile(arg.slice('--file='.length), step, original)
    if (!/^-[A-Za-z]/.test(arg) || arg.startsWith('--')) continue
    // Short options: `-m<msg>` / `-F<file>` carry their value; a cluster like `-am` or `-sF` takes the next word
    if (arg.startsWith('-m') && arg.length > 2) return messageFromValue(arg.slice(2))
    if (arg.startsWith('-F') && arg.length > 2) return messageFromFile(arg.slice(2), step, original)
    if (arg.endsWith('m')) return messageFromValue(next)
    if (arg.endsWith('F')) return messageFromFile(next, step, original)
  }
  return { subject: null }
}
