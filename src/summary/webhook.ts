import os from 'os'
import { log } from '../utils/logger'
import { postToWebhook } from '../integrations/webhook'
import { formatForSlack, isSlackWebhookUrl } from '../integrations/slack'
import type { WorkscribeConfig } from '../config'

export interface WebhookOptions {
  slack?: boolean
  webhook?: string
}

interface PostSummaryInput {
  options: WebhookOptions
  config: WorkscribeConfig
  summary: string
  /** True when stdout carries only JSON or plain text: status lines then go to stderr so the output can be piped. */
  statusToStderr?: boolean
}

/** Posts a finished summary to --webhook, or to the configured Slack webhook with --slack. Never throws. */
export async function postSummary({
  options,
  config,
  summary,
  statusToStderr = false,
}: PostSummaryInput): Promise<void> {
  const status = statusToStderr ? { info: log.notice, success: log.notice, warn: log.notice } : log
  const webhookUrl = options.webhook ?? (options.slack ? config.integrations?.slackWebhook : undefined)

  if (!webhookUrl) {
    if (options.slack && !config.integrations?.slackWebhook) {
      status.warn('--slack requires integrations.slackWebhook to be set in config')
    }
    return
  }

  try {
    status.info('Posting to webhook…')
    const body = isSlackWebhookUrl(webhookUrl) ? formatForSlack(summary, os.userInfo().username) : summary
    await postToWebhook(webhookUrl, body)
    status.success('Posted.')
  } catch (error) {
    log.error(`Webhook failed: ${(error as Error).message}`)
  }
}
