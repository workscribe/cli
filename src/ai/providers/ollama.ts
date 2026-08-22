import type { AIProvider, DaySummaryPayload, WeekSummaryPayload } from '../types'
import { getSystemPrompt, buildUserMessage, WEEKLY_SYSTEM_PROMPT, buildWeeklyMessage } from '../prompt'
import { fetchWithTimeout } from '../fetch'

export class OllamaProvider implements AIProvider {
  private model: string
  private baseUrl: string

  constructor(model?: string, baseUrl?: string) {
    this.model = model || 'llama3'
    this.baseUrl = baseUrl || 'http://localhost:11434'
  }

  async summarize(payload: DaySummaryPayload): Promise<string> {
    const response = await fetchWithTimeout(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          { role: 'system', content: getSystemPrompt() },
          { role: 'user', content: buildUserMessage(payload) },
        ],
        options: {
          num_predict: 300, // hard cap on output tokens — forces conciseness
          temperature: 0.3, // lower temperature = more focused, less wandering
        },
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Ollama error ${response.status}: ${body}. Is Ollama running? Try: ollama serve`)
    }

    const data = (await response.json()) as { message: { content: string } }
    return data.message?.content ?? ''
  }

  async validate(): Promise<void> {
    const response = await fetchWithTimeout(`${this.baseUrl}/api/tags`, { method: 'GET' })
    if (!response.ok) {
      throw new Error(`Ollama is not reachable at ${this.baseUrl}. Is it running? Try: ollama serve`)
    }
  }

  async summarizeWeek(payload: WeekSummaryPayload): Promise<string> {
    const response = await fetchWithTimeout(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        stream: false,
        messages: [
          { role: 'system', content: WEEKLY_SYSTEM_PROMPT },
          { role: 'user', content: buildWeeklyMessage(payload) },
        ],
        options: {
          num_predict: 400,
          temperature: 0.3,
        },
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Ollama error ${response.status}: ${body}. Is Ollama running? Try: ollama serve`)
    }

    const data = (await response.json()) as { message: { content: string } }
    return data.message?.content ?? ''
  }
}
