import type { AIProvider, DaySummaryPayload, WeekSummaryPayload } from '../types'
import { getSystemPrompt, buildUserMessage, WEEKLY_SYSTEM_PROMPT, buildWeeklyMessage } from '../prompt'
import { fetchWithTimeout } from '../fetch'

export class OpenAIProvider implements AIProvider {
  private apiKey: string
  private model: string
  private baseUrl: string

  constructor(apiKey: string, model?: string, baseUrl?: string) {
    this.apiKey = apiKey
    this.model = model || 'gpt-4o-mini'
    this.baseUrl = baseUrl || 'https://api.openai.com/v1'
  }

  async summarize(payload: DaySummaryPayload): Promise<string> {
    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: getSystemPrompt() },
          { role: 'user', content: buildUserMessage(payload) },
        ],
        max_tokens: 1024,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`OpenAI API error ${response.status}: ${body}`)
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
    }
    return data.choices[0]?.message?.content ?? ''
  }

  async validate(): Promise<void> {
    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: '.' }],
        max_tokens: 1,
      }),
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`OpenAI API error ${response.status}: ${body}`)
    }
  }

  async summarizeWeek(payload: WeekSummaryPayload): Promise<string> {
    const response = await fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: WEEKLY_SYSTEM_PROMPT },
          { role: 'user', content: buildWeeklyMessage(payload) },
        ],
        max_tokens: 1024,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`OpenAI API error ${response.status}: ${body}`)
    }

    const data = (await response.json()) as {
      choices: Array<{ message: { content: string } }>
    }
    return data.choices[0]?.message?.content ?? ''
  }
}
