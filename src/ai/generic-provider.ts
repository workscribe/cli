import type { AIProvider, DaySummaryPayload, WeekSummaryPayload } from './types'
import { getSystemPrompt, buildUserMessage, WEEKLY_SYSTEM_PROMPT, buildWeeklyMessage } from './prompt'
import { fetchWithTimeout } from '../utils/fetch'
import type { ProviderConfig } from './provider-config'

export class GenericProvider implements AIProvider {
  constructor(
    private config: ProviderConfig,
    private model: string,
    private apiKey: string,
    private baseUrl: string,
    private includeCategories: string[] = []
  ) {}

  private async call(system: string, userMsg: string, maxTokens: number): Promise<string> {
    const response = await fetchWithTimeout(this.config.chatUrl(this.baseUrl, this.apiKey, this.model), {
      method: 'POST',
      headers: this.config.headers(this.apiKey),
      body: JSON.stringify(this.config.buildChatBody(this.model, system, userMsg, maxTokens)),
    })
    if (!response.ok) {
      throw new Error(this.config.chatError(response.status, await response.text()))
    }
    return this.config.parseText(await response.json())
  }

  async summarize(payload: DaySummaryPayload): Promise<string> {
    return this.call(getSystemPrompt(), buildUserMessage(payload, this.includeCategories), this.config.dailyTokens)
  }

  async summarizeWeek(payload: WeekSummaryPayload): Promise<string> {
    return this.call(WEEKLY_SYSTEM_PROMPT, buildWeeklyMessage(payload), this.config.weeklyTokens)
  }

  async validate(): Promise<void> {
    const isPost = this.config.validateMethod === 'POST'
    const response = await fetchWithTimeout(this.config.validateUrl(this.baseUrl, this.apiKey, this.model), {
      method: this.config.validateMethod,
      headers: isPost ? this.config.headers(this.apiKey) : undefined,
      body:
        isPost && this.config.buildValidateBody ? JSON.stringify(this.config.buildValidateBody(this.model)) : undefined,
    })
    if (!response.ok) {
      throw new Error(this.config.validateError(response.status, await response.text(), this.baseUrl))
    }
  }
}
