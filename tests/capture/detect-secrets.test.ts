import { describe, it, expect } from 'vitest'
import { containsSecrets } from '../../src/capture/detect-secrets'

describe('containsSecrets', () => {
  it('returns false for plain text with no credentials', () => {
    expect(containsSecrets('help me refactor this function')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(containsSecrets('')).toBe(false)
  })

  it('returns true when prompt contains an AWS access key', () => {
    expect(containsSecrets('my key is AKIAIOSFODNN7EXAMPLE and it fails')).toBe(true)
  })

  it('returns true when prompt contains a GitHub personal access token', () => {
    expect(containsSecrets('use token ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ1234567890 to auth')).toBe(true)
  })

  it('returns true when prompt contains a JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    expect(containsSecrets(`my token is ${jwt}`)).toBe(true)
  })

  it('returns true when prompt contains a Stripe live key', () => {
    expect(containsSecrets('sk_live_abcdefghijklmnopqrstuvwx')).toBe(true)
  })

  it('returns true when prompt contains an export with a sensitive variable', () => {
    expect(containsSecrets('export API_KEY=supersecretvalue123')).toBe(true)
  })

  it('returns true when prompt contains a database URL with embedded password', () => {
    expect(containsSecrets('connect to postgres://admin:hunter2@db.example.com/mydb')).toBe(true)
  })

  it('returns false for prompts with variable names but no values', () => {
    expect(containsSecrets('what does the API_KEY variable do?')).toBe(false)
  })

  it('returns false for common shell commands without sensitive values', () => {
    expect(containsSecrets('git commit -m "add feature" && npm run build')).toBe(false)
  })

  it('returns true for prose with an apostrophe before a quoted password', () => {
    expect(containsSecrets(`don't log --password "hunter2" here`)).toBe(true)
  })

  it('returns true for a password that contains a semicolon', () => {
    expect(containsSecrets('export PASSWORD=ab;cd')).toBe(true)
  })

  it('returns false for a compound command whose quotes only mention a flag', () => {
    expect(containsSecrets('echo "use mongo -p" && git switch -c x && echo "y"')).toBe(false)
  })

  it('returns true for a pasted line that assigns a credential in code', () => {
    expect(containsSecrets(`const password = "changeme123"`)).toBe(true)
  })

  it('returns false for code that only reads one', () => {
    expect(containsSecrets('const token = process.env.TOKEN')).toBe(false)
  })
})
