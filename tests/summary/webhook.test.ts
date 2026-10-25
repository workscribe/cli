import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/integrations/webhook', () => ({ postToWebhook: vi.fn() }))
vi.mock('../../src/integrations/slack', () => ({
  formatForSlack: vi.fn(() => 'slack-formatted'),
  isSlackWebhookUrl: vi.fn(),
}))

import { postSummary } from '../../src/summary/webhook'
import { postToWebhook } from '../../src/integrations/webhook'
import { formatForSlack, isSlackWebhookUrl } from '../../src/integrations/slack'
import { log } from '../../src/utils/logger'
import type { WorkscribeConfig } from '../../src/config'

const mockPostToWebhook = postToWebhook as ReturnType<typeof vi.fn>
const mockIsSlackWebhookUrl = isSlackWebhookUrl as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const SLACK_URL = 'https://hooks.slack.com/services/T/B/X'
const NO_INTEGRATIONS = { integrations: {} } as WorkscribeConfig
const WITH_SLACK = { integrations: { slackWebhook: SLACK_URL } } as WorkscribeConfig

beforeEach(() => {
  mockPostToWebhook.mockResolvedValue(undefined)
  mockIsSlackWebhookUrl.mockImplementation((url: string) => url.startsWith('https://hooks.slack.com/'))
})

describe('postSummary', () => {
  it('does nothing without --webhook or --slack', async () => {
    await postSummary({}, WITH_SLACK, 'summary')

    expect(mockPostToWebhook).not.toHaveBeenCalled()
    expect(mockLog.warn).not.toHaveBeenCalled()
  })

  it('posts the raw summary to a non-Slack --webhook', async () => {
    await postSummary({ webhook: 'https://example.com/hook' }, NO_INTEGRATIONS, 'summary')

    expect(mockPostToWebhook).toHaveBeenCalledWith('https://example.com/hook', 'summary')
  })

  it('prefers --webhook over the configured Slack webhook', async () => {
    await postSummary({ webhook: 'https://example.com/hook', slack: true }, WITH_SLACK, 'summary')

    expect(mockPostToWebhook).toHaveBeenCalledWith('https://example.com/hook', 'summary')
  })

  it('formats for Slack when --slack uses the configured Slack webhook', async () => {
    await postSummary({ slack: true }, WITH_SLACK, 'summary')

    expect(formatForSlack).toHaveBeenCalledWith('summary', expect.any(String))
    expect(mockPostToWebhook).toHaveBeenCalledWith(SLACK_URL, 'slack-formatted')
  })

  it('warns when --slack is passed but no Slack webhook is configured', async () => {
    await postSummary({ slack: true }, NO_INTEGRATIONS, 'summary')

    expect(mockPostToWebhook).not.toHaveBeenCalled()
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('integrations.slackWebhook'))
  })

  it('logs a failed post instead of throwing', async () => {
    mockPostToWebhook.mockRejectedValue(new Error('HTTP 500'))

    await postSummary({ webhook: 'https://example.com/hook' }, NO_INTEGRATIONS, 'summary')

    expect(mockLog.error).toHaveBeenCalledWith('Webhook failed: HTTP 500')
  })
})
