import { afterEach, describe, expect, it, vi } from 'vitest';
import { HttpAiProviderClient, type ProviderRequest } from './ai-provider.client.js';

const request: ProviderRequest = {
  provider: 'groq',
  model: 'llama-3.3-70b-versatile',
  apiKey: 'gsk_test-key-1234',
  messages: [{ role: 'user', content: 'hi' }],
  tools: [
    { name: 'get_my_goals', description: 'd', parameters: { type: 'object', properties: {} } },
  ],
};

const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

afterEach(() => vi.unstubAllGlobals());

describe('HttpAiProviderClient', () => {
  it('posts to the fixed provider URL with the key as a bearer token and parses a text answer', async () => {
    const fetchMock = vi.fn(() => reply({ choices: [{ message: { content: 'Hello' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new HttpAiProviderClient().complete(request);
    expect(result).toEqual({ content: 'Hello', toolCalls: [] });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer gsk_test-key-1234');
    expect(init.redirect).toBe('error');
    const sent = JSON.parse(init.body as string);
    expect(sent.tools[0].function.name).toBe('get_my_goals');
    expect(JSON.stringify(sent)).not.toContain('gsk_test-key');
  });

  it('parses tool calls', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        reply({
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: 'c1',
                    function: { name: 'who_is_off', arguments: '{"from":"2026-10-26"}' },
                  },
                  { function: {} },
                ],
              },
            },
          ],
        }),
      ),
    );
    const result = await new HttpAiProviderClient().complete(request);
    expect(result.toolCalls).toEqual([
      { id: 'c1', name: 'who_is_off', arguments: '{"from":"2026-10-26"}' },
    ]);
  });

  it.each([
    [401, 'rejected_key'],
    [403, 'rejected_key'],
    [429, 'provider_rate_limited'],
    [500, 'provider_down'],
    [400, 'bad_request'],
  ])('maps status %i to %s without forwarding the provider text', async (status, reason) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply({ error: { message: 'your key gsk_test-key-1234 is bad' } }, status)),
    );
    await expect(new HttpAiProviderClient().complete(request)).rejects.toMatchObject({
      code: 'AI_PROVIDER_ERROR',
      params: { reason },
    });
  });

  it('reports network failures, timeouts and malformed answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('boom'))),
    );
    await expect(new HttpAiProviderClient().complete(request)).rejects.toMatchObject({
      params: { reason: 'network' },
    });
    const timeout = new Error('t');
    timeout.name = 'TimeoutError';
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(timeout)),
    );
    await expect(new HttpAiProviderClient().complete(request)).rejects.toMatchObject({
      params: { reason: 'timeout' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('not json', { status: 200 }))),
    );
    await expect(new HttpAiProviderClient().complete(request)).rejects.toMatchObject({
      params: { reason: 'bad_response' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => reply({ choices: [] })),
    );
    await expect(new HttpAiProviderClient().complete(request)).rejects.toMatchObject({
      params: { reason: 'bad_response' },
    });
  });
});
