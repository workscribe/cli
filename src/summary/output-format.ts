// What `summary` and `week` can print. A leaf, so the commands and the week flow share it without loading the config.
export const SUMMARY_FORMATS = ['markdown', 'json', 'text'] as const
export type SummaryFormat = (typeof SUMMARY_FORMATS)[number]

/** Formats meant to be piped or pasted: stdout carries the output alone, and everything else goes to stderr. */
export function keepsStdoutClean(format: string | undefined): boolean {
  return format === 'json' || format === 'text'
}
