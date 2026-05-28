/**
 * Converts workscribe markdown summary output to Slack mrkdwn format.
 *
 * Rules:
 *   ## heading  →  *heading*  (bold)
 *   - bullet    →  • bullet
 *
 * All other content is passed through unchanged.
 */
export function formatForSlack(markdown: string): string {
  return markdown.replace(/^## (.+)$/gm, '*$1*').replace(/^- /gm, '• ')
}

export function isSlackWebhookUrl(url: string): boolean {
  return url.startsWith('https://hooks.slack.com/')
}
