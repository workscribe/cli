export interface ProviderConfig {
  defaultModel: string
  defaultBaseUrl: string
  dailyTokens: number
  weeklyTokens: number
  // apiKey and model are provided for providers that embed them in the URL (e.g. Gemini)
  chatUrl: (baseUrl: string, apiKey: string, model: string) => string
  validateUrl: (baseUrl: string, apiKey: string, model: string) => string
  validateMethod: 'GET' | 'POST'
  headers: (apiKey: string) => Record<string, string>
  buildChatBody: (model: string, system: string, userMsg: string, maxTokens: number) => object
  buildValidateBody?: (model: string) => object
  parseText: (json: unknown) => string
  chatError: (status: number, body: string) => string
  validateError: (status: number, body: string, baseUrl: string) => string
}

export const PROVIDER_CONFIGS: Record<string, ProviderConfig> = {
  anthropic: {
    defaultModel: 'claude-haiku-4-5-20251001',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    dailyTokens: 1024,
    weeklyTokens: 1024,
    chatUrl: (baseUrl) => `${baseUrl}/messages`,
    validateUrl: (baseUrl) => `${baseUrl}/messages`,
    validateMethod: 'POST',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }),
    buildChatBody: (model, system, userMsg, maxTokens) => ({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: userMsg }],
    }),
    buildValidateBody: (model) => ({
      model,
      max_tokens: 1,
      messages: [{ role: 'user', content: '.' }],
    }),
    parseText: (json) => {
      const data = json as { content: Array<{ type: string; text: string }> }
      return data.content.find((b) => b.type === 'text')?.text ?? ''
    },
    chatError: (status, body) => `Anthropic API error ${status}: ${body}`,
    validateError: (status, body) => `Anthropic API error ${status}: ${body}`,
  },

  openai: {
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com/v1',
    dailyTokens: 1024,
    weeklyTokens: 1024,
    chatUrl: (baseUrl) => `${baseUrl}/chat/completions`,
    validateUrl: (baseUrl) => `${baseUrl}/chat/completions`,
    validateMethod: 'POST',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }),
    buildChatBody: (model, system, userMsg, maxTokens) => ({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
      max_tokens: maxTokens,
    }),
    buildValidateBody: (model) => ({
      model,
      messages: [{ role: 'user', content: '.' }],
      max_tokens: 1,
    }),
    parseText: (json) => {
      const data = json as { choices: Array<{ message: { content: string } }> }
      return data.choices[0]?.message?.content ?? ''
    },
    chatError: (status, body) => `OpenAI API error ${status}: ${body}`,
    validateError: (status, body) => `OpenAI API error ${status}: ${body}`,
  },

  ollama: {
    defaultModel: 'llama3',
    defaultBaseUrl: 'http://localhost:11434',
    dailyTokens: 300,
    weeklyTokens: 400,
    chatUrl: (baseUrl) => `${baseUrl}/api/chat`,
    validateUrl: (baseUrl) => `${baseUrl}/api/tags`,
    validateMethod: 'GET',
    headers: () => ({ 'Content-Type': 'application/json' }),
    buildChatBody: (model, system, userMsg, maxTokens) => ({
      model,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
      options: { num_predict: maxTokens, temperature: 0.3 },
    }),
    parseText: (json) => {
      return (json as { message: { content: string } }).message?.content ?? ''
    },
    chatError: (status, body) => `Ollama error ${status}: ${body}. Is Ollama running? Try: ollama serve`,
    validateError: (_status, _body, baseUrl) =>
      `Ollama is not reachable at ${baseUrl}. Is it running? Try: ollama serve`,
  },

  gemini: {
    defaultModel: 'gemini-2.0-flash-lite',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    dailyTokens: 1024,
    weeklyTokens: 1024,
    // API key and model are embedded in the URL — not in headers
    chatUrl: (baseUrl, apiKey, model) => `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
    validateUrl: (baseUrl, apiKey, model) => `${baseUrl}/models/${model}:generateContent?key=${apiKey}`,
    validateMethod: 'POST',
    headers: () => ({ 'Content-Type': 'application/json' }),
    buildChatBody: (_model, system, userMsg, maxTokens) => ({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: userMsg }] }],
      generationConfig: { maxOutputTokens: maxTokens, temperature: 0.3 },
    }),
    buildValidateBody: () => ({
      contents: [{ role: 'user', parts: [{ text: '.' }] }],
      generationConfig: { maxOutputTokens: 1 },
    }),
    parseText: (json) => {
      const data = json as { candidates: Array<{ content: { parts: Array<{ text: string }> } }> }
      return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    },
    chatError: (status, body) => `Gemini API error ${status}: ${body}`,
    validateError: (status, body) => `Gemini API error ${status}: ${body}`,
  },

  groq: {
    defaultModel: 'llama-3.1-8b-instant',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    dailyTokens: 1024,
    weeklyTokens: 1024,
    chatUrl: (baseUrl) => `${baseUrl}/chat/completions`,
    validateUrl: (baseUrl) => `${baseUrl}/models`,
    validateMethod: 'GET',
    headers: (apiKey) => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }),
    buildChatBody: (model, system, userMsg, maxTokens) => ({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userMsg },
      ],
      max_tokens: maxTokens,
    }),
    parseText: (json) => {
      const data = json as { choices: Array<{ message: { content: string } }> }
      return data.choices?.[0]?.message?.content ?? ''
    },
    chatError: (status, body) => `Groq API error ${status}: ${body}`,
    validateError: (status, body) => `Groq API error ${status}: ${body}`,
  },
}
