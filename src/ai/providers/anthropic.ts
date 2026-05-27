import type { AIProvider, DaySummaryPayload } from '../types'
import { SYSTEM_PROMPT, buildUserMessage } from '../prompt'
import { fetchWithTimeout } from '../fetch'

export class AnthropicProvider implements AIProvider {
  private apiKey: string
  private model: string

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey
    this.model = model || 'claude-haiku-4-5-20251001'
  }

  async summarize(payload: DaySummaryPayload): Promise<string> {
    const response = await fetchWithTimeout('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: buildUserMessage(payload) }],
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Anthropic API error ${response.status}: ${body}`)
    }

    const data = (await response.json()) as { content: Array<{ type: string; text: string }> }
    return data.content.find((c) => c.type === 'text')?.text ?? ''
  }
}
