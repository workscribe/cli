import { redact } from './redact'

export function containsSecrets(text: string): boolean {
  return redact(text) !== text
}
