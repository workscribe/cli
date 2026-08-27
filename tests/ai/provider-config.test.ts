import { describe, it, expect } from 'vitest'
import { PROVIDER_CONFIGS } from '../../src/ai/provider-config'

// ─── Gemini ───────────────────────────────────────────────────────────────────

describe('PROVIDER_CONFIGS.gemini', () => {
  const gemini = PROVIDER_CONFIGS.gemini

  it('has the correct default model', () => {
    expect(gemini.defaultModel).toBe('gemini-2.0-flash-lite')
  })

  it('embeds apiKey and model in the chat URL', () => {
    const url = gemini.chatUrl('https://generativelanguage.googleapis.com/v1beta', 'my-key', 'gemini-2.0-flash-lite')
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=my-key'
    )
  })

  it('embeds apiKey and model in the validate URL', () => {
    const url = gemini.validateUrl(
      'https://generativelanguage.googleapis.com/v1beta',
      'my-key',
      'gemini-2.0-flash-lite'
    )
    expect(url).toContain('?key=my-key')
    expect(url).toContain('gemini-2.0-flash-lite')
  })

  it('does not put the apiKey in headers', () => {
    const headers = gemini.headers('my-key')
    const headerValues = Object.values(headers).join(' ')
    expect(headerValues).not.toContain('my-key')
  })

  it('uses system_instruction and contents in the chat body', () => {
    const body = gemini.buildChatBody('gemini-2.0-flash-lite', 'system prompt', 'user message', 512) as Record<
      string,
      unknown
    >
    expect(body).toHaveProperty('system_instruction')
    expect(body).toHaveProperty('contents')
    expect(body).not.toHaveProperty('messages')
  })

  it('puts system text in system_instruction.parts', () => {
    const body = gemini.buildChatBody('gemini-2.0-flash-lite', 'be concise', 'summarise this', 512) as {
      system_instruction: { parts: Array<{ text: string }> }
    }
    expect(body.system_instruction.parts[0].text).toBe('be concise')
  })

  it('puts user text in contents[0].parts', () => {
    const body = gemini.buildChatBody('gemini-2.0-flash-lite', 'system', 'user input', 512) as {
      contents: Array<{ role: string; parts: Array<{ text: string }> }>
    }
    expect(body.contents[0].parts[0].text).toBe('user input')
    expect(body.contents[0].role).toBe('user')
  })

  it('parses text from candidates[0].content.parts[0].text', () => {
    const response = {
      candidates: [{ content: { parts: [{ text: 'summary text' }] } }],
    }
    expect(gemini.parseText(response)).toBe('summary text')
  })

  it('returns empty string when candidates array is empty', () => {
    expect(gemini.parseText({ candidates: [] })).toBe('')
  })

  it('formats chatError with status and body', () => {
    expect(gemini.chatError(400, 'bad request')).toContain('400')
    expect(gemini.chatError(400, 'bad request')).toContain('bad request')
  })

  it('formats validateError with status and body', () => {
    expect(gemini.validateError(401, 'unauthorized', '')).toContain('401')
  })
})

// ─── Groq ─────────────────────────────────────────────────────────────────────

describe('PROVIDER_CONFIGS.groq', () => {
  const groq = PROVIDER_CONFIGS.groq

  it('has the correct default model', () => {
    expect(groq.defaultModel).toBe('llama-3.1-8b-instant')
  })

  it('points to the Groq base URL', () => {
    expect(groq.defaultBaseUrl).toBe('https://api.groq.com/openai/v1')
  })

  it('chat URL is /chat/completions', () => {
    expect(groq.chatUrl('https://api.groq.com/openai/v1', 'key', 'model')).toBe(
      'https://api.groq.com/openai/v1/chat/completions'
    )
  })

  it('validate URL is /models (GET)', () => {
    expect(groq.validateUrl('https://api.groq.com/openai/v1', 'key', 'model')).toBe(
      'https://api.groq.com/openai/v1/models'
    )
    expect(groq.validateMethod).toBe('GET')
  })

  it('puts apiKey in Authorization Bearer header', () => {
    const headers = groq.headers('gsk_mykey')
    expect(headers['Authorization']).toBe('Bearer gsk_mykey')
  })

  it('uses OpenAI-style messages array in chat body', () => {
    const body = groq.buildChatBody('llama-3.1-8b-instant', 'system prompt', 'user message', 512) as {
      messages: Array<{ role: string; content: string }>
    }
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toBe('system prompt')
    expect(body.messages[1].role).toBe('user')
    expect(body.messages[1].content).toBe('user message')
  })

  it('parses text from choices[0].message.content', () => {
    const response = { choices: [{ message: { content: 'summary output' } }] }
    expect(groq.parseText(response)).toBe('summary output')
  })

  it('returns empty string when choices array is empty', () => {
    expect(groq.parseText({ choices: [] })).toBe('')
  })

  it('formats chatError with status and body', () => {
    expect(groq.chatError(429, 'rate limited')).toContain('429')
    expect(groq.chatError(429, 'rate limited')).toContain('rate limited')
  })

  it('formats validateError with status and body', () => {
    expect(groq.validateError(401, 'invalid key', '')).toContain('401')
  })
})

// ─── Router error messages ────────────────────────────────────────────────────

describe('provider list completeness', () => {
  it('includes gemini in PROVIDER_CONFIGS', () => {
    expect(PROVIDER_CONFIGS).toHaveProperty('gemini')
  })

  it('includes groq in PROVIDER_CONFIGS', () => {
    expect(PROVIDER_CONFIGS).toHaveProperty('groq')
  })
})
