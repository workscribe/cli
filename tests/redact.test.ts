import { describe, it, expect } from 'vitest'
import { redact } from '../src/capture/redact'

describe('redact', () => {
  describe('AWS keys', () => {
    it('redacts AWS access key IDs', () => {
      const cmd = 'aws s3 cp AKIAIOSFODNN7EXAMPLE secret'
      expect(redact(cmd)).toContain('[REDACTED]')
      expect(redact(cmd)).not.toMatch(/AKIA/)
    })

    it('redacts AWS secret via environment variable', () => {
      const cmd = 'export AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
      expect(redact(cmd)).toContain('[REDACTED]')
      expect(redact(cmd)).not.toContain('wJalrXUtnFEMI')
    })
  })

  describe('GitHub tokens', () => {
    it('redacts ghp_ tokens', () => {
      const token = 'ghp_' + 'a'.repeat(36)
      expect(redact(`git clone https://${token}@github.com/org/repo`)).toContain('[REDACTED]')
      expect(redact(`git clone https://${token}@github.com/org/repo`)).not.toContain(token)
    })

    it('redacts github_pat_ tokens', () => {
      const token = 'github_pat_' + 'a'.repeat(82)
      expect(redact(`echo ${token}`)).toContain('[REDACTED]')
    })
  })

  describe('JWTs', () => {
    it('redacts JWT tokens', () => {
      const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
      expect(redact(`curl -H "Authorization: Bearer ${jwt}" https://api.example.com`)).toContain('[REDACTED]')
      expect(redact(`curl -H "Authorization: Bearer ${jwt}" https://api.example.com`)).not.toContain('eyJhbGci')
    })
  })

  describe('Slack tokens', () => {
    it('redacts xoxb- bot tokens', () => {
      expect(redact('slack send --token xoxb-123-456-abc')).toContain('[REDACTED]')
    })

    it('redacts xoxp- user tokens', () => {
      expect(redact('echo xoxp-111-222-333-secret')).toContain('[REDACTED]')
    })
  })

  describe('Stripe keys', () => {
    it('redacts live stripe keys', () => {
      expect(redact('stripe charges create sk_live_' + 'x'.repeat(24))).toContain('[REDACTED]')
    })

    it('redacts test stripe keys', () => {
      expect(redact('echo sk_test_' + 'x'.repeat(24))).toContain('[REDACTED]')
    })
  })

  describe('flag-based secrets', () => {
    it('redacts --password flag values', () => {
      const result = redact('psql --password mysecretpassword -U admin')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('mysecretpassword')
    })

    it('redacts --secret flag values', () => {
      const result = redact('app deploy --secret topsecretvalue')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('topsecretvalue')
    })

    it('redacts --token flag values', () => {
      const result = redact('cli login --token abc123xyz')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('abc123xyz')
    })

    it('redacts --key flag values', () => {
      const result = redact('tool --key myprivatekey')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('myprivatekey')
    })
  })

  describe('export statements', () => {
    it('redacts exported API_KEY values', () => {
      const result = redact('export API_KEY=supersecret123')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('supersecret123')
    })

    it('redacts exported TOKEN values', () => {
      const result = redact('export AUTH_TOKEN=bearer-abc-def')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('bearer-abc-def')
    })

    it('redacts exported PASSWORD values', () => {
      const result = redact('export DB_PASSWORD=hunter2')
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('hunter2')
    })

    it('does NOT redact benign export statements', () => {
      const result = redact('export NODE_ENV=production')
      expect(result).toBe('export NODE_ENV=production')
    })

    it('does NOT redact exported PATH', () => {
      const result = redact('export PATH=/usr/local/bin:$PATH')
      expect(result).toBe('export PATH=/usr/local/bin:$PATH')
    })
  })

  describe('safe commands', () => {
    it('leaves normal git commands untouched', () => {
      const cmd = 'git commit -m "fix: auth bug"'
      expect(redact(cmd)).toBe(cmd)
    })

    it('leaves npm install untouched', () => {
      const cmd = 'npm install axios'
      expect(redact(cmd)).toBe(cmd)
    })

    it('leaves docker commands untouched', () => {
      const cmd = 'docker build -t myapp .'
      expect(redact(cmd)).toBe(cmd)
    })
  })

  describe('multiple secrets in one command', () => {
    it('redacts all occurrences', () => {
      const awsKey = 'AKIAIOSFODNN7EXAMPLE'
      const ghToken = 'ghp_' + 'b'.repeat(36)
      const cmd = `deploy --key ${awsKey} --token ${ghToken}`
      const result = redact(cmd)
      expect(result).not.toContain(awsKey)
      expect(result).not.toContain(ghToken)
    })
  })

  describe('extra patterns', () => {
    it('applies custom regex patterns', () => {
      const result = redact('connect mydb://user:MYSECRET@host', ['MYSECRET'])
      expect(result).toContain('[REDACTED]')
      expect(result).not.toContain('MYSECRET')
    })

    it('silently ignores invalid regex patterns', () => {
      expect(() => redact('git status', ['[invalid'])).not.toThrow()
    })

    it('still applies builtin patterns when extras are invalid', () => {
      const token = 'ghp_' + 'c'.repeat(36)
      const result = redact(`echo ${token}`, ['[invalid'])
      expect(result).toContain('[REDACTED]')
    })
  })
})
