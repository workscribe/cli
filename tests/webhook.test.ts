import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/ai/fetch', () => ({
  fetchWithTimeout: vi.fn(),
}))

import { fetchWithTimeout } from '../src/ai/fetch'
import { postToWebhook } from '../src/integrations/webhook'

const mockFetch = fetchWithTimeout as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('postToWebhook', () => {
  it('sends correct JSON body to the URL', async () => {
    mockFetch.mockResolvedValue({ ok: true })

    await postToWebhook('https://hooks.example.com/abc', 'hello world')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit, number]
    expect(url).toBe('https://hooks.example.com/abc')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ text: 'hello world' })
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json')
  })

  it('throws on non-2xx response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    })

    await expect(postToWebhook('https://hooks.example.com/abc', 'hi')).rejects.toThrow(
      'Webhook POST failed 403: Forbidden',
    )
  })
})
