// Rules and messages for `workscribe sessions summary set` — pure; the command does the I/O.

const BYTES_PER_KB = 1024
const MAX_SKILL_SUMMARY_KB = 8

/** Largest summary the agent skill may save for one session, in bytes. */
export const MAX_SKILL_SUMMARY_BYTES = MAX_SKILL_SUMMARY_KB * BYTES_PER_KB

// Shown whenever no summary text arrives, so the fix is a copy-paste away
const SEND_TEXT_EXAMPLE = [
  'Send the summary text into the command, for example:',
  '',
  "  workscribe sessions summary set --key '<key from workscribe sessions --json>' <<'EOF'",
  '  ## my-project (main) — 1h 30m',
  '  - What you got done',
  '  EOF',
].join('\n')

export const INTERACTIVE_STDIN_MESSAGE = `This command saves summary text that is sent to it — it can't be typed in here.\n${SEND_TEXT_EXAMPLE}`

export function stdinReadFailedMessage(error: unknown): string {
  return `Couldn't read the summary text that was sent in: ${(error as Error).message}`
}

/** `16384` → `16,384` — thousands separators only, no unit scaling. */
function formatCount(count: number): string {
  return count.toLocaleString('en-US')
}

/** A friendly error for a summary that can't be saved, or null when it's fine. */
export function validateSkillSummary(text: string): string | null {
  if (text.trim() === '') return `Nothing to save — no summary text was received.\n${SEND_TEXT_EXAMPLE}`
  const bytes = Buffer.byteLength(text, 'utf-8')
  if (bytes > MAX_SKILL_SUMMARY_BYTES) {
    return (
      `This summary is too long to save (${formatCount(bytes)} bytes; the limit is ` +
      `${formatCount(MAX_SKILL_SUMMARY_BYTES)}, about ${MAX_SKILL_SUMMARY_KB} KB). Shorten it and try again.`
    )
  }
  return null
}
