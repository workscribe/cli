import type { AIProvider, DaySummaryPayload } from '../types'
import { SYSTEM_PROMPT, buildUserMessage } from '../prompt'
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
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserMessage(payload) },
        ],
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
