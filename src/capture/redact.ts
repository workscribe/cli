// A flag's value: quoted, spaces and all, or one word. A leading `-` is the next flag, not a value (`mongosh -p --tls`).
const VALUE = String.raw`(?:"[^"]*"|'[^']*'|[^\s"'\-]\S*)`
// The rest of one simple command, so a flag is only read as a tool's when it's that tool's
const SAME_COMMAND = String.raw`[^|;&\n]*?`

const LONG_SECRET_FLAGS =
  'password|passwd|pass|pwd|secret|secret-key|client-secret|client_secret|token|access-token|auth-token|' +
  'refresh-token|key|private-key|api[-_]?key|auth[-_]?token'

/** Matches the value that follows `prefix`, leaving the prefix in place. */
function valueAfter(prefix: string, flags = 'g'): RegExp {
  return new RegExp(`(?<=${prefix})${VALUE}`, flags)
}

/** Matches a short flag's value, only for these tools: `-p` is a password for `sshpass`, a port for `ssh`. */
function toolFlagValue(tools: string, flag: string): RegExp {
  return valueAfter(String.raw`\b(?:${tools})\b${SAME_COMMAND}\s${flag}`)
}

// Patterns that match known sensitive values
const BUILTIN_PATTERNS: RegExp[] = [
  // AWS access keys
  /AKIA[0-9A-Z]{16}/g,
  // AWS secret access keys (40 char base64-ish after common env vars)
  /(?<=AWS_SECRET_ACCESS_KEY[=\s]+)\S+/gi,
  // GitHub tokens
  /\bgh[pousr]_[a-zA-Z0-9]{36}/g,
  /github_pat_[a-zA-Z0-9_]{82}/g,
  // AI provider, Google and npm keys
  /\bsk-[a-zA-Z0-9_-]{20,}/g,
  /\bAIza[a-zA-Z0-9_-]{30,}/g,
  /\bnpm_[a-zA-Z0-9]{30,}/g,
  // GitLab tokens
  /glpat-[a-zA-Z0-9\-]{20}/g,
  // Generic JWTs (three base64url segments)
  /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  // Slack tokens and incoming webhook URLs
  /xox[baprs]-[a-zA-Z0-9\-]+/g,
  /https:\/\/hooks\.slack\.com\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[a-zA-Z0-9]+/g,
  // Stripe keys
  /sk_(live|test)_[a-zA-Z0-9]{24,}/g,
  // Values after long-form secret flags, `--flag value` or `--flag=value`. `--password-stdin` isn't one: no match on its
  // `-stdin`, and the value can't start with `-`. A bare short flag means nothing without knowing the tool: see below
  valueAfter(String.raw`(?<![\w-])--(?:${LONG_SECRET_FLAGS})(?:\s+|=)`, 'gi'),
  // A password attached to the flag: `mysql -pSECRET`. `mysql -p db` prompts, so there's no value to remove, and
  // `psql -p 5432` is a port, so psql isn't listed
  toolFlagValue('mysql|mysqldump|mysqladmin|mysqlimport|mysqlshow|mysqlcheck|mariadb|mariadb-dump', '-p'),
  // Short flags that take a secret, for the tools where they do
  toolFlagValue('sshpass', String.raw`-p\s*`),
  toolFlagValue('mongosh|mongo', String.raw`-p\s+`),
  toolFlagValue('redis-cli', String.raw`-a\s+`),
  toolFlagValue('ssh-keygen', String.raw`-[NP]\s+`),
  toolFlagValue('zip|unzip', String.raw`-P\s+`),
  valueAfter(String.raw`\b(?:docker|podman|nerdctl|helm)\b${SAME_COMMAND}\blogin\b${SAME_COMMAND}\s-p\s+`),
  // openssl's `-pass pass:SECRET`, also -passin and -passout
  /(?<=\s-pass(?:in|out|word)?\s+pass:)\S+/g,
  // The password half of `curl -u user:password`
  /(?<=\bcurl\b[^|;&\n]*?\s(?:-u|--user)[\s=]+["']?[^:\s"']*:)[^\s"']+/g,
  // Tokens handed over on stdin: `echo SECRET | docker login --password-stdin`, `gh auth login --with-token <<< SECRET`
  new RegExp(String.raw`(?<=\b(?:echo|printf)\s+)${VALUE}(?=\s*\|[^;&\n]*--(?:password-stdin|with-token))`, 'g'),
  valueAfter(String.raw`--(?:password-stdin|with-token)\s*<<<\s*`),
  // Headers. A scheme is required for Authorization, so prose like "Authorization: added middleware" stays
  /(?<=\bauthorization:\s*(?:bearer|basic|token)\s+)[^\s"']+/gi,
  /(?<=\bbearer\s+)(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{8,}/gi,
  /(?<=\b(?:x-api-key|api-key|x-auth-token|x-access-token|cookie|set-cookie):\s*)[^\s"'][^"'\n]*/gi,
  // Private keys, whole blocks, as heredocs and `echo` can carry them
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // password=... inside a string or query: `psql "host=x password=SECRET"`, `--from-literal=password=SECRET`
  /(?<=(?:^|[\s"'?&=])(?:password|passwd|pwd)=)[^\s"';&]+/gi,
  // npm's auth settings, with or without `=`: `npm config set //registry/:_password SECRET`
  /(?<=:_(?:password|auth|authToken)[=\s]+)\S+/g,
  // export VAR=VALUE where VAR looks sensitive
  /(?<=export\s+(?:[A-Z_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASS|AUTH|CREDENTIAL|_PWD)[A-Z_]*)=)\S+/gi,
  // Inline assignment: VAR_WITH_SENSITIVE_KEYWORD=value cmd  (e.g. API_KEY=secret npm start)
  // Lookbehind matches only the variable-name= prefix, so only the value is replaced
  /(?<=[A-Z_][A-Z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD|PASS|AUTH|CREDENTIAL|_PWD)[A-Z0-9_]*=)\S+/gi,
  // Credentials embedded in connection string URLs (e.g. DATABASE_URL=postgres://user:pass@host/db)
  // Matches the password segment between :// user : password @ — preserves scheme and host
  /(?<=[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:@\s/]+:)[^@\s]+(?=@)/g,
  // A token as the whole userinfo of an https URL: `git clone https://TOKEN@github.com/org/repo`
  /(?<=https?:\/\/)[^\s:@/]+(?=@)/g,
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
