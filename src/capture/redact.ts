import { closingQuotePositions } from './shell-syntax'

const QUOTED = String.raw`"[^"]*"|'[^']*'`
// Quotes, brackets and shell separators stay in a word only with more of the word after it, so `"add --pass option"`
// keeps its closing quote and `--password=a&b` or `PASSWORD=ab;cd` lose all of their value. Text that isn't a shell
// command (a note, an agent's message) can hold a secret with a `;` in it, so this is the safe default
const WORD_REST = String.raw`(?:[^\s"');&|]|["');&|](?=[^\s;&|)]))*`
// In a command a short flag's unquoted value ends at `;`, as a shell word does: `mysql -pX;git switch -c y` keeps its
// `git`. Only the patterns that read a command's flags use this
const SHELL_WORD_REST = String.raw`(?:[^\s"');&|]|["')&|](?=[^\s;&|)]))*`
// A flag's value. A leading `-` is the next flag, not a value (`mongosh -p --tls`).
const VALUE = String.raw`(?:${QUOTED}|[^\s"'\-]${WORD_REST})`
const SHELL_VALUE = String.raw`(?:${QUOTED}|[^\s"'\-]${SHELL_WORD_REST})`
const VALUE_OR_DASHED = String.raw`(?:${QUOTED}|[^\s"']${WORD_REST})`
// The limits keep a very long line fast, as these patterns run inside lookbehinds. A quoted string counts as one part
const MAX_COMMAND_PARTS = 1000
const MAX_QUOTED_LENGTH = 64_000
const MAX_PARTS_BEFORE_LOGIN = 200
const MAX_PARTS_AFTER_LOGIN = 300
// One simple command's next parts: a separator in quotes doesn't end it, and neither does a line continuation. Quotes
// that don't pair, as in `-u o\'brien`, are read as plain characters instead, so they can't hide the flag after them
function sameCommand(maxParts: number): string {
  const quoted = String.raw`"[^"]{0,${MAX_QUOTED_LENGTH}}"|'[^']{0,${MAX_QUOTED_LENGTH}}'`
  return String.raw`(?:(?:${quoted}|\\\n|[^|;&\n"']){0,${maxParts}}?|[^|;&\n]{0,${maxParts}}?)`
}
const SAME_COMMAND = sameCommand(MAX_COMMAND_PARTS)
// Tools are found by leaving out what can't be one, not by listing where one can be: a form nobody listed (`timeout 30
// mysql -pX`) must cost a lost word at worst, never a stored password. So not `a.zip` or `mongo:7`, the container in
// `--name mongo`, the host in `ssh mongo -p 22`, or a word in a message: `git commit -m "fix mongo -p flag"`
const NOT_PART_OF_A_WORD = String.raw`(?<![\w.:@-])`
const NOT_A_NAME = String.raw`(?<!--name(?:\s+|=)|\bssh\s+)`
const NOT_IN_A_MESSAGE = String.raw`(?<!\s(?:-[as]*m|--message|--title|--body|--subject)[\s=]*["'][^"'\n]{0,${MAX_COMMAND_PARTS}})`
// A lookbehind runs right to left, so the slow check goes first here and runs last
const TOOL_WORD_START = `${NOT_IN_A_MESSAGE}${NOT_A_NAME}${NOT_PART_OF_A_WORD}`
// A version after the name is still the tool: `mysql@8`, Homebrew's name for it
const TOOL_WORD_END = String.raw`(?:@\d[\w.]*)?(?:\.exe)?["'\x60)]?(?=\s)`
// `-p 27017:27017` publishes a port. A bare number stays a possible password: `mongosh -p 12345`
const NOT_A_PORT_MAPPING = String.raw`(?!(?:[\d.]+:)?\d+:\d+(?:\/\w+)?(?=\s|$))`

const LONG_SECRET_FLAGS = [
  'password',
  '(?!no-)[\\w-]*-password',
  'passwd',
  'passphrase',
  'pass',
  'pwd',
  'secret(?:-key)?',
  'client[-_]secret',
  'token',
  'access-token',
  'refresh-token',
  'auth[-_]?token',
  'private-key',
  'api[-_]?key',
].join('|')
// After a long flag, `=` always introduces a value, and a space does unless the next flag follows
const LONG_FLAG_VALUE_START = String.raw`(?:=|\s+(?!--))`
// `sort --key=2,3` and `--key certs/server.key` name a field and a file, not a secret
const MAX_SORT_FIELD_DIGITS = 2
const SORT_FIELD = String.raw`\d{1,${MAX_SORT_FIELD_DIGITS}}`
const NOT_A_KEY = String.raw`(?:${SORT_FIELD}(?:[.,]${SORT_FIELD})*|[\w./~-]*\.(?:key|pem|crt|p12|pfx|der)|[\w./~-]*\/id_\w+)(?=\s|$)`
// A branch, not a key: lowercase words, none of them long. A real key has a long run or mixed case
const MAX_SLUG_WORD_LENGTH = 15
const MAX_SLUG_WORDS_AFTER_FIRST = 8
const SLUG_WORD = `[a-z0-9]{1,${MAX_SLUG_WORD_LENGTH}}`
const UUID_IN_A_KEY = String.raw`[a-z-]{0,20}[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`
const SLUG_AFTER_SK = String.raw`(?!${UUID_IN_A_KEY})${SLUG_WORD}(?:-${SLUG_WORD}){0,${MAX_SLUG_WORDS_AFTER_FIRST}}(?![\w-])`
const CONTAINER_LOGIN_TOOLS = 'docker|podman|podman-remote|nerdctl|helm'
const EVERYDAY_HEADERS = 'api-key|cookie|set-cookie'
// Not everyday words, unlike `cookie`, so they count anywhere: `http x.io X-Api-Key:SECRET`, `HDR="X-Api-Key: SECRET"`
const DISTINCTIVE_HEADERS = 'x-api-key|x-auth-token|x-access-token|private-token|x-token'
const HEADER_FLAG = String.raw`(?<![\w-])(?:-\w*H|--(?:proxy-)?header)[\s=]*`

/** Matches the value that follows `prefix`, leaving the prefix in place. */
function valueAfter(prefix: string, value = VALUE): RegExp {
  return new RegExp(`(?<=${prefix})${value}`, 'g')
}

/** Matches a short flag's value, when the tool is a word of the same command. */
function toolFlagValue(tools: string, flag: string): RegExp {
  return valueAfter(String.raw`${TOOL_WORD_START}(?:${tools})${TOOL_WORD_END}${SAME_COMMAND}\s${flag}`, SHELL_VALUE)
}

/** Matches what follows `name` in `"name:value"` and `'name:value'`. Each stops where its quoting does. */
function quotedValuesAfterName(prefix: string, name: string, flags = 'g'): RegExp[] {
  return [
    new RegExp(String.raw`(?<=${prefix}"${name})[^"\s][^"\n]*`, flags),
    new RegExp(String.raw`(?<=${prefix}'${name})[^'\s][^'\n]*`, flags),
  ]
}

/** Matches what follows `name` in `name:value`, in each way a shell can quote it. */
function valuesAfterName(prefix: string, name: string, flags = 'g'): RegExp[] {
  return [
    ...quotedValuesAfterName(prefix, name, flags),
    new RegExp(String.raw`(?<=${prefix}${name})(?:${QUOTED})`, flags),
    new RegExp(String.raw`(?<=${prefix}${name})[^\s"'|;&]+`, flags),
  ]
}

const SENSITIVE_VARIABLE_WORDS = 'TOKEN|SECRET|KEY|PASSWORD|PASS|AUTH|CREDENTIAL|_PWD'
const QUERY_SECRET_NAME = String.raw`key|[\w-]*(?:token|secret|password|passwd|pwd|api[-_]?key)`
const JSON_SECRET_NAME = String.raw`[\w-]*(?:token|secret|password|passwd|pwd|api[-_]?key)`

// Patterns that match known sensitive values
const BUILTIN_PATTERNS: RegExp[] = [
  // AWS access keys
  /AKIA[0-9A-Z]{16}/g,
  // AWS secret access keys (40 char base64-ish after common env vars)
  new RegExp(String.raw`(?<=AWS_SECRET_ACCESS_KEY[=\s]+)${VALUE_OR_DASHED}`, 'gi'),
  // GitHub tokens
  /\bgh[pousr]_[a-zA-Z0-9]{36}/g,
  /github_pat_[a-zA-Z0-9_]{82}/g,
  // AI provider, Google and npm keys
  new RegExp(String.raw`\bsk-(?!${SLUG_AFTER_SK})[\w-]{20,}`, 'g'),
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
  // `-stdin`. A bare short flag means nothing without knowing the tool: see below
  new RegExp(String.raw`(?<=(?<![\w-])--(?:${LONG_SECRET_FLAGS})${LONG_FLAG_VALUE_START})${VALUE_OR_DASHED}`, 'gi'),
  new RegExp(String.raw`(?<=(?<![\w-])--key${LONG_FLAG_VALUE_START})(?!${NOT_A_KEY})${VALUE_OR_DASHED}`, 'gi'),
  // A password attached to the flag: `mysql -pSECRET`. `mysql -p db` prompts, so there's no value to remove, and
  // `psql -p 5432` is a port, so psql isn't listed
  toolFlagValue(
    'mysql|mysqldump|mysqladmin|mysqlimport|mysqlshow|mysqlcheck|mycli|mysqlsh|mariadb|mariadb-dump|mariadb-admin|' +
      'mariadb-import|mariadb-show|mariadb-check',
    '-p'
  ),
  // Short flags that take a secret, for the tools where they do
  toolFlagValue('sshpass', String.raw`-p\s*`),
  toolFlagValue('mongosh|mongo|mongodump|mongorestore|mongoexport|mongoimport', String.raw`-p\s*${NOT_A_PORT_MAPPING}`),
  toolFlagValue('redis-cli', String.raw`-a\s*`),
  toolFlagValue('ssh-keygen', String.raw`-[NP]\s*`),
  toolFlagValue('zip|unzip', String.raw`-P\s*`),
  // 7-Zip's password is attached to the flag, like mysql's: `7z a -pSECRET out.7z dir`
  toolFlagValue('7z|7za|7zr', '-p'),
  toolFlagValue('openssl', String.raw`-k\s+`),
  valueAfter(
    String.raw`${TOOL_WORD_START}(?:${CONTAINER_LOGIN_TOOLS})${TOOL_WORD_END}[^|;&\n]{0,${MAX_PARTS_BEFORE_LOGIN}}?\slogin` +
      String.raw`${TOOL_WORD_END}${sameCommand(MAX_PARTS_AFTER_LOGIN)}\s-p\s*${NOT_A_PORT_MAPPING}`,
    SHELL_VALUE
  ),
  // openssl's `-pass pass:SECRET`, also -passin and -passout, with or without quotes around it
  /(?<=\s-pass(?:in|out|word)?\s+pass:)\S+/g,
  /(?<=\s-pass(?:in|out|word)?\s+["']pass:)[^"'\s]+/g,
  // curl's cookies, which also covers a cookie file's name: `curl -b s=SECRET`
  valueAfter(String.raw`\bcurl\b["']?${SAME_COMMAND}\s(?:--cookie|-\w*b)[\s=]+`),
  // The password half of `curl -u user:password`
  ...valuesAfterName(String.raw`\bcurl\b["']?${SAME_COMMAND}\s(?:-\w*u[\s=]*|--user[\s=]+)`, String.raw`[^:\s"']*:`),
  // The password half of httpie's `http -a user:password`
  ...valuesAfterName(
    String.raw`${TOOL_WORD_START}(?:http|https|xh|xhs)${TOOL_WORD_END}${SAME_COMMAND}\s(?:-a[\s=]*|--auth[\s=]+)`,
    String.raw`[^:\s"']*:`
  ),
  // A secret's value given as a flag: `gh secret set NAME --body SECRET`, or `kubectl create secret generic s
  // --from-literal=token=SECRET`
  valueAfter(String.raw`\bgh\s+secret\s+set\b${SAME_COMMAND}\s(?:--body|-b)[\s=]+`, SHELL_VALUE),
  new RegExp(
    String.raw`(?<=--from-literal=[\w.-]*(?:token|secret|password|passwd|pwd|api[-_]?key)[\w.-]*=)${VALUE_OR_DASHED}`,
    'gi'
  ),
  // Tokens handed over on stdin: `echo SECRET | docker login --password-stdin`, `gh auth login --with-token <<< SECRET`
  new RegExp(
    String.raw`(?<=\b(?:echo(?:\s+-[neE]+)*|printf(?:\s+["']?%s(?:\\n)?["']?)?)\s+)${VALUE}` +
      String.raw`(?=\s*\|[^;&\n]{0,${MAX_COMMAND_PARTS}}?--(?:password-stdin|with-token))`,
    'g'
  ),
  valueAfter(String.raw`--(?:password-stdin|with-token)\s*<<<\s*`),
  // Headers. A scheme or a header flag is required for Authorization, so prose like "Authorization: added middleware"
  // stays. An everyday word needs to look like a header, so `git commit -m "cookie: rotate on login"` stays: a header
  // flag, `Cookie:value` with no space, or a quoted `"Cookie: value"` outside a message
  /(?<=\bauthorization:\s*(?:bearer|basic|token)\s+)[^\s"']+/gi,
  /(?<=\bbearer\s+)(?=[A-Za-z0-9._~+/=-]*\d)[A-Za-z0-9._~+/=-]{8,}/gi,
  ...valuesAfterName(HEADER_FLAG, String.raw`(?:${EVERYDAY_HEADERS}):\s*`, 'gi'),
  ...valuesAfterName(HEADER_FLAG, String.raw`authorization:\s*(?!(?:bearer|basic|token)\s)`, 'gi'),
  ...quotedValuesAfterName('', String.raw`${NOT_IN_A_MESSAGE}(?:${EVERYDAY_HEADERS}):\s*`, 'gi'),
  ...valuesAfterName('', String.raw`(?<![\w-])(?:${EVERYDAY_HEADERS}):`, 'gi'),
  ...valuesAfterName('', String.raw`\b(?:${DISTINCTIVE_HEADERS}):\s*`, 'gi'),
  // Private keys, whole blocks, as heredocs and `echo` can carry them
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  // password=... inside a string or query: `psql "host=x password=SECRET"`, `--set db.password=SECRET`
  /(?<=(?:^|[\s"'?&=.])(?:password|passwd|pwd)=)[^\s"';&]+/gi,
  // A secret in a query string or in JSON: `curl "x.io?token=SECRET"`, `curl -d '{"password":"SECRET"}'`
  new RegExp(String.raw`(?<=[?&](?:${QUERY_SECRET_NAME})=)[^\s"'&#]+`, 'gi'),
  new RegExp(String.raw`(?<=["'](?:${JSON_SECRET_NAME})\\?["']\s*:\s*\\?")[^"\\\n]+`, 'gi'),
  // npm's auth settings, with or without `=`: `npm config set //registry/:_password SECRET`
  /(?<=:_(?:password|auth|authToken)[=\s]+)\S+/g,
  // export VAR=VALUE where VAR looks sensitive
  new RegExp(String.raw`(?<=export\s+(?:[A-Z_]*(?:${SENSITIVE_VARIABLE_WORDS})[A-Z_]*)=)${VALUE_OR_DASHED}`, 'gi'),
  // Inline assignment: VAR_WITH_SENSITIVE_KEYWORD=value cmd  (e.g. API_KEY=secret npm start)
  // Lookbehind matches only the variable-name= prefix, so only the value is replaced
  new RegExp(String.raw`(?<=[A-Z_][A-Z0-9_]*(?:${SENSITIVE_VARIABLE_WORDS})[A-Z0-9_]*=)${VALUE_OR_DASHED}`, 'gi'),
  // The same with nothing before the keyword: `TOKEN=SECRET npm start`. Capitals only, so `--author=me` and `key=value` stay
  new RegExp(
    String.raw`(?<=(?:^|[\s;&|(])(?:TOKEN|SECRET|KEY|PASSWORD|PASS|AUTH|CREDENTIALS?)=)${VALUE_OR_DASHED}`,
    'g'
  ),
  // Credentials embedded in connection string URLs (e.g. DATABASE_URL=postgres://user:pass@host/db)
  // Matches the password segment between :// user : password @ — preserves scheme and host
  /(?<=[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:@\s/]*:)[^@\s]+(?=@)/g,
  // A token as the whole userinfo of an https URL: `git clone https://TOKEN@github.com/org/repo`
  /(?<=https?:\/\/)[^\s:@/?#]+(?=@)/g,
]

export const REDACTED_TEXT = '[REDACTED]'

/**
 * Replaces what `pattern` matches, except a match that begins with a quote that ends a string. A value in quotes starts
 * at the quote that opens it: in `echo "use mongo -p" && git switch -c x && echo "y"`, the quote right after `-p` ends
 * the first string, and what it would take as the value is the command between the strings.
 */
function redactBuiltin(text: string, pattern: RegExp): string {
  let result = ''
  let copiedUpTo = 0
  let closingQuotes: Set<number> | undefined
  // Found on the first quote-leading match only, so a line without one costs nothing
  const closingQuoteIndexes = () => (closingQuotes ??= closingQuotePositions(text))
  pattern.lastIndex = 0
  for (let found = pattern.exec(text); found; found = pattern.exec(text)) {
    const [match] = found
    const startsWithQuote = match.startsWith('"') || match.startsWith("'")
    if (startsWithQuote && closingQuoteIndexes().has(found.index)) {
      // Not a value, and not the end of the search: a real one can start inside this text
      pattern.lastIndex = found.index + 1
      continue
    }
    result += text.slice(copiedUpTo, found.index) + REDACTED_TEXT
    copiedUpTo = found.index + match.length
    if (match === '') pattern.lastIndex++
  }
  return result + text.slice(copiedUpTo)
}

export function redact(command: string, extraPatterns: string[] = []): string {
  let result = command

  for (const pattern of BUILTIN_PATTERNS) {
    result = redactBuiltin(result, pattern)
  }

  for (const extraPattern of extraPatterns) {
    try {
      result = result.replace(new RegExp(extraPattern, 'g'), REDACTED_TEXT)
    } catch {
      // Invalid regex — skip silently
    }
  }

  return result
}
