import { fetchWithTimeout } from '../ai/fetch'

export async function postToWebhook(url: string, text: string): Promise<void> {
  const response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    },
    10_000
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Webhook POST failed ${response.status}: ${body}`)
  }
}
