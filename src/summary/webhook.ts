import os from 'os'
import { log } from '../utils/logger'
import { postToWebhook } from '../integrations/webhook'
import { formatForSlack, isSlackWebhookUrl } from '../integrations/slack'
import type { WorkscribeConfig } from '../config'

export interface WebhookOptions {
  slack?: boolean
  webhook?: string
}

/** Posts a finished summary to --webhook, or to the configured Slack webhook with --slack. Never throws. */
export async function postSummary(options: WebhookOptions, config: WorkscribeConfig, summary: string): Promise<void> {
  const webhookUrl = options.webhook ?? (options.slack ? config.integrations?.slackWebhook : undefined)

  if (!webhookUrl) {
    if (options.slack && !config.integrations?.slackWebhook) {
      log.warn('--slack requires integrations.slackWebhook to be set in config')
    }
    return
  }

  try {
    log.info('Posting to webhook…')
    const body = isSlackWebhookUrl(webhookUrl) ? formatForSlack(summary, os.userInfo().username) : summary
    await postToWebhook(webhookUrl, body)
    log.success('Posted.')
  } catch (error) {
    log.error(`Webhook failed: ${(error as Error).message}`)
  }
}
