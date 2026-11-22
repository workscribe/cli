import { describe, it, expect } from 'vitest'
import { redact } from '../../src/capture/redact'
import { boundedCommand } from '../../src/capture/command-steps'

// WOR-204: a secret a command writes as plain text. FAKEVALUE stands where a secret would be.

describe('written text: secrets a writer command emits', () => {
  it.each([
    // echo
    ['echo "password: FAKEVALUE" > f.yaml', 'echo "password: [REDACTED]" > f.yaml'],
    ["echo 'token = FAKEVALUE' >> config", "echo 'token = [REDACTED]' >> config"],
    ['echo "api_key: FAKEVALUE" >> config.yml', 'echo "api_key: [REDACTED]" >> config.yml'],
    ['echo password: FAKEVALUE > p.yaml', 'echo password: [REDACTED] > p.yaml'],
    ['echo "password:FAKEVALUE" > p.yaml', 'echo "password:[REDACTED]" > p.yaml'],
    ['echo "password:   FAKEVALUE" > p.yaml', 'echo "password:   [REDACTED]" > p.yaml'],
    ['echo "client_secret: FAKEVALUE" > c.yaml', 'echo "client_secret: [REDACTED]" > c.yaml'],
    ['echo "db.password: FAKEVALUE" > c.yaml', 'echo "db.password: [REDACTED]" > c.yaml'],
    ['echo -e "db:\\n  password: FAKEVALUE" > f.yaml', 'echo -e "db:\\n  password: [REDACTED]" > f.yaml'],
    ['echo "password: FAKEVALUE" | tee -a creds.yaml', 'echo "password: [REDACTED]" | tee -a creds.yaml'],
    // a key in capitals, as YAML and INI files write them
    ['echo "Password: FAKEVALUE" > f.yaml', 'echo "Password: [REDACTED]" > f.yaml'],
    ['echo "TOKEN: FAKEVALUE" > f.yaml', 'echo "TOKEN: [REDACTED]" > f.yaml'],
    ['echo "Db_Password: FAKEVALUE" > f.yaml', 'echo "Db_Password: [REDACTED]" > f.yaml'],
    ['echo "API_KEY: FAKEVALUE" > f.yaml', 'echo "API_KEY: [REDACTED]" > f.yaml'],
    // INI style, with a space each side of the equals sign
    ['echo "api_secret = wJalrXUtnFEMI" >> app.ini', 'echo "api_secret = [REDACTED]" >> app.ini'],
    ['echo "password = hunter2024" > app.ini', 'echo "password = [REDACTED]" > app.ini'],
    // printf
    ["printf 'password: %s\\n' FAKEVALUE > p.yaml", "printf 'password: %s\\n' [REDACTED] > p.yaml"],
    ['printf "password: FAKEVALUE\\nuser: bob\\n" > c.yaml', 'printf "password: [REDACTED]\\nuser: bob\\n" > c.yaml'],
    [
      "printf 'user: %s\\ntoken: %s\\n' bob FAKEVALUE > c.yaml",
      "printf 'user: %s\\ntoken: %s\\n' bob [REDACTED] > c.yaml",
    ],
    // a quoted printf argument
    ['printf \'password: %s\\n\' "FAKEVALUE" > p.yaml', "printf 'password: %s\\n' [REDACTED] > p.yaml"],
    // here-strings
    ['tee f.yaml <<< "token: FAKEVALUE"', 'tee f.yaml <<< "token: [REDACTED]"'],
    ['cat <<< "password: FAKEVALUE" > p.yaml', 'cat <<< "password: [REDACTED]" > p.yaml'],
    ['cat > f.yaml <<< "password: FAKEVALUE"', 'cat > f.yaml <<< "password: [REDACTED]"'],
    // sed, awk and one-line scripts
    [
      'sed -i "s/password:.*/password: FAKEVALUE/" values.yaml',
      'sed -i "s/password:.*/password: [REDACTED]/" values.yaml',
    ],
    ["sed -i '' 's/^token:.*/token: FAKEVALUE/' x.yaml", "sed -i '' 's/^token:.*/token: [REDACTED]/' x.yaml"],
    ['awk \'{print "token: FAKEVALUE"}\' f > g.yaml', 'awk \'{print "token: [REDACTED]"}\' f > g.yaml'],
    [
      `python3 -c "open('c.yaml','w').write('password: FAKEVALUE')"`,
      `python3 -c "open('c.yaml','w').write('password: [REDACTED]')"`,
    ],
    [
      `node -e "fs.writeFileSync('c.yaml','token: FAKEVALUE')"`,
      `node -e "fs.writeFileSync('c.yaml','token: [REDACTED]')"`,
    ],
    // a writer inside another command
    [`sh -c 'echo "password: FAKEVALUE" > /f.yaml'`, `sh -c 'echo "password: [REDACTED]" > /f.yaml'`],
    [`ssh host 'echo "token: FAKEVALUE" >> ~/.f'`, `ssh host 'echo "token: [REDACTED]" >> ~/.f'`],
  ])('redacts %s', (command, expected) => {
    expect(redact(command)).toBe(expected)
  })
})

describe('written text: a credentials file written line by line', () => {
  it('holds no secret access key once it is stored', () => {
    const command = 'echo "aws_secret_access_key = wJalrXUtnFEMI" >> ~/.aws/credentials'

    expect(redact(command)).not.toContain('wJalrXUtnFEMI')
  })
})

describe('written text: a bare secret written to a file named for it', () => {
  it.each([
    ['echo -n FAKEVALUE > .secret', 'echo -n [REDACTED] > .secret'],
    ['echo FAKEVALUE > ~/.vault-pass', 'echo [REDACTED] > ~/.vault-pass'],
    ['echo FAKEVALUE | tee ~/.vault-pass', 'echo [REDACTED] | tee ~/.vault-pass'],
    ['echo "FAKEVALUE" > my_token.txt', 'echo "[REDACTED]" > my_token.txt'],
    ['printf FAKEVALUE >> /etc/app/credentials.json', 'printf [REDACTED] >> /etc/app/credentials.json'],
    ['echo FAKEVALUE > passwords.txt', 'echo [REDACTED] > passwords.txt'],
  ])('redacts %s', (command, expected) => {
    expect(redact(command)).toBe(expected)
  })

  it.each([
    'echo hello > passenger.log',
    'echo done > .secretive',
    'echo 3 > token_count.txt',
    'echo $TOKEN > token.txt',
    'echo FAKEVALUE > out.txt',
    'echo "ssh-rsa AAAAB3NzaC1yc2E" >> ~/.ssh/authorized_keys',
    'echo FAKEVALUE > bypass.txt',
  ])('leaves %s alone', (command) => {
    expect(redact(command)).toBe(command)
  })
})

describe('written text: what stays', () => {
  it.each([
    'echo "token: <your token here>"',
    'echo "password: ${DB_PASSWORD}"',
    'echo "password: $DB_PASSWORD"',
    'printf \'secret: %s\\n\' "$NAME"',
    'echo "the secret: see the vault"',
    'echo "token: x"',
    'echo "pass: no"',
    'printf \'password: %s\\n\' "$NAME" > p.yaml',
    'echo "set password = prompt"',
    'echo "password = input"',
    'node -e "const token = getToken()"',
    'python3 -c "password = input(\'password: \')"',
    'echo "password: true"',
    'echo "Password: "',
    'echo "bypass: FAKEVALUE" > f.yaml',
    'echo "tokenizer: FAKEVALUE" > f.yaml',
    'echo hello > a.yaml',
    'git commit -m "docs: explain password: policy"',
    'git commit -m "run echo password: FAKEVALUE"',
    'grep -r "password: " src',
    'cat values.yaml | grep password',
  ])('leaves %s alone', (command) => {
    expect(redact(command)).toBe(command)
  })

  it('leaves the text of a note alone: it is not a command', () => {
    expect(redact('rotated password: required yesterday')).toBe('rotated password: required yesterday')
  })
})

describe('written text: accepted over-redaction', () => {
  // A word lost from a writer command costs a summary little: the hint still says what was done
  it.each([
    ['echo "password: required" > notes.txt', 'echo "password: [REDACTED]" > notes.txt'],
    ['echo "token: expired" > n.txt', 'echo "token: [REDACTED]" > n.txt'],
    ['echo "token = getToken()"', 'echo "token = [REDACTED])"'],
    ['echo "pass: through"', 'echo "pass: [REDACTED]"'],
    // the slash inside a value is part of it, so the key after it is taken for the rest of the value
    ["sed -i 's/password: old/password: new/' f", "sed -i 's/password: [REDACTED] new/' f"],
    [
      'sed -i "s/password:.*/password: changed/" values.yaml',
      'sed -i "s/password:.*/password: [REDACTED]/" values.yaml',
    ],
    [
      "printf 'password: %s user: %s\\n' FAKEVALUE bobsmith > p",
      "printf 'password: %s user: %s\\n' [REDACTED] [REDACTED] > p",
    ],
  ])('%s', (command, expected) => {
    expect(redact(command)).toBe(expected)
  })
})

describe('written text: known limits', () => {
  // A spaced `key = value` is read only when its value has a digit or a capital, so prose such as `set password = prompt`
  // stays; an all-lowercase INI value is therefore not read, and `privacy.md` says so (WOR-204)
  it('does not read a lowercase value after a spaced equals sign', () => {
    expect(redact('echo "token = abcdefgh" >> app.ini')).toBe('echo "token = abcdefgh" >> app.ini')
  })

  it('redacts a multi-word value only up to its first space', () => {
    expect(redact('echo "password: correcthorse battery staple" > f.yaml')).toBe(
      'echo "password: [REDACTED] battery staple" > f.yaml'
    )
  })

  it('does not read a secret under 6 characters', () => {
    expect(redact('echo "password: abc12" > f.yaml')).toBe('echo "password: abc12" > f.yaml')
  })
})

describe('written text: a heredoc body is not stored', () => {
  // Out of scope for redaction on purpose: capture removes the body before the command is stored (WOR-204)
  const stored = (command: string): string => boundedCommand(redact(command))

  it.each([
    'kubectl apply -f - <<EOF\napiVersion: v1\nkind: Secret\nstringData:\n  password: FAKEVALUE\nEOF',
    "kubectl apply -f - <<'EOF'\nstringData:\n  password: FAKEVALUE\nEOF",
    'cat > values.yaml <<EOF\ndb:\n  password: FAKEVALUE\nEOF',
    'cat <<EOF | kubectl apply -f -\nstringData:\n  password: FAKEVALUE\nEOF',
  ])('holds no secret once %j is stored', (command) => {
    expect(stored(command)).not.toContain('FAKEVALUE')
  })

  it('redacts a writer a heredoc leaves behind in a command substitution', () => {
    const command = 'cat <<EOF\nuser: $(echo token: FAKEVALUE)\nEOF'

    expect(stored(command)).not.toContain('FAKEVALUE')
  })
})
