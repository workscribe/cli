const HINT_LENGTH = 120

/** What's kept of an unclassified command so a summary can describe it. Takes the command already redacted. */
export function commandHint(safeCommand: string): string {
  return safeCommand.trim().slice(0, HINT_LENGTH)
}
