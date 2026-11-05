/**
 * Converts workscribe markdown summary output to Slack mrkdwn format.
 *
 * Rules:
 *   ## heading  →  *heading*  (bold)
 *   - bullet    →  • bullet
 *
 * An optional username is prepended as a dim header line so recipients
 * can tell who sent the summary in shared channels.
 */
export function formatForSlack(markdown: string, username?: string): string {
  // Slack has no headings: the day's `## ` and the week's `### ` both become bold lines
  const body = markdown.replace(/^#{2,3} (.+)$/gm, '*$1*').replace(/^- /gm, '• ')
  return username ? `_${username}_\n${body}` : body
}

export function isSlackWebhookUrl(url: string): boolean {
  return url.startsWith('https://hooks.slack.com/')
}
