// Patterns that match known sensitive values
const BUILTIN_PATTERNS: RegExp[] = [
  // AWS access keys
  /AKIA[0-9A-Z]{16}/g,
  // AWS secret access keys (40 char base64-ish after common env vars)
  /(?<=AWS_SECRET_ACCESS_KEY[=\s]+)\S+/gi,
  // GitHub tokens
  /ghp_[a-zA-Z0-9]{36}/g,
  /github_pat_[a-zA-Z0-9_]{82}/g,
  // GitLab tokens
  /glpat-[a-zA-Z0-9\-]{20}/g,
  // Generic JWTs (three base64url segments)
  /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  // Slack tokens and incoming webhook URLs
  /xox[baprs]-[a-zA-Z0-9\-]+/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[a-zA-Z0-9]+/g,
  // Stripe keys
  /sk_(live|test)_[a-zA-Z0-9]{24,}/g,
  // Values after long-form secret flags (single-char flags like -t/-p/-k are too ambiguous)
  /(?<=--(password|passwd|secret|token|key|api[-_]?key|auth[-_]?token)\s+)\S+/gi,
  // export VAR=VALUE where VAR looks sensitive
  /(?<=export\s+(?:[A-Z_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASS|AUTH|CREDENTIAL)[A-Z_]*)=)\S+/gi,
  // Inline assignment: VAR_WITH_SENSITIVE_KEYWORD=value cmd  (e.g. API_KEY=secret npm start)
  // Lookbehind matches only the variable-name= prefix, so only the value is replaced
  /(?<=[A-Z_][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASS|AUTH|CREDENTIAL)[A-Z0-9_]*=)\S+/gi,
  // Credentials embedded in connection string URLs (e.g. DATABASE_URL=postgres://user:pass@host/db)
  // Matches the password segment between :// user : password @ — preserves scheme and host
  /(?<=[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:@\s/]+:)[^@\s]+(?=@)/g,
]

export function redact(command: string, extraPatterns: string[] = []): string {
  let result = command

  const allPatterns = [...BUILTIN_PATTERNS]

  for (const pattern of extraPatterns) {
    try {
      allPatterns.push(new RegExp(pattern, 'g'))
    } catch {
      // Invalid regex — skip silently
    }
  }

  for (const pattern of allPatterns) {
    // Reset lastIndex for global regexes
    pattern.lastIndex = 0
    result = result.replace(pattern, '[REDACTED]')
  }

  return result
}
