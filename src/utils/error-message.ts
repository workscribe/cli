/** The message from anything thrown — an Error's message, or the thrown value itself as text. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
