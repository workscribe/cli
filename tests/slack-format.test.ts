import { describe, it, expect } from 'vitest'
import { formatForSlack, isSlackWebhookUrl } from '../src/integrations/slack'

describe('formatForSlack', () => {
  it('converts ## headings to bold', () => {
    expect(formatForSlack('## api-service (main) — 1h 30m')).toBe('*api-service (main) — 1h 30m*')
  })

  it('converts - bullets to •', () => {
    expect(formatForSlack('- Resolved failing tests')).toBe('• Resolved failing tests')
  })

  it('converts a full summary', () => {
    const input = [
      '## api-service (feature/auth) — 2h 00m',
      '- Installed JWT and bcrypt dependencies',
      '- Resolved failing auth tests',
      '- Committed and pushed authentication fixes',
    ].join('\n')

    const expected = [
      '*api-service (feature/auth) — 2h 00m*',
      '• Installed JWT and bcrypt dependencies',
      '• Resolved failing auth tests',
      '• Committed and pushed authentication fixes',
    ].join('\n')

    expect(formatForSlack(input)).toBe(expected)
  })

  it('handles multiple sessions', () => {
    const input = '## api-service — 1h\n- Work A\n\n## dashboard — 30m\n- Work B'
    const result = formatForSlack(input)
    expect(result).toContain('*api-service — 1h*')
    expect(result).toContain('*dashboard — 30m*')
    expect(result).toContain('• Work A')
    expect(result).toContain('• Work B')
  })

  it('leaves plain text lines unchanged', () => {
    expect(formatForSlack('No activity captured for today')).toBe('No activity captured for today')
  })

  it('does not convert ### or # headings', () => {
    expect(formatForSlack('# top level')).toBe('# top level')
    expect(formatForSlack('### sub heading')).toBe('### sub heading')
  })

  it('does not convert mid-line hyphens', () => {
    expect(formatForSlack('feature/auth-service')).toBe('feature/auth-service')
  })
})

describe('isSlackWebhookUrl', () => {
  it('returns true for Slack incoming webhook URLs', () => {
    expect(isSlackWebhookUrl('https://hooks.slack.com/services/T00000000/B00000000/XXXX')).toBe(true)
  })

  it('returns false for custom webhook URLs', () => {
    expect(isSlackWebhookUrl('https://my-server.example.com/hook')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isSlackWebhookUrl('')).toBe(false)
  })
})
