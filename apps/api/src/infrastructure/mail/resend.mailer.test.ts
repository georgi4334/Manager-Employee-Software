import { describe, expect, it, vi } from 'vitest';
import { ResendMailer } from './resend.mailer.js';

const message = { to: 'ada@acme.eu', subject: 'Hello', text: 'Body with a link' };

describe('ResendMailer', () => {
  it('posts the message with the API key as a bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"id":"1"}', { status: 200 }));
    await new ResendMailer('re_key', 'InTime <no-reply@acme.eu>', fetchMock).send(message);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer re_key');
    expect(JSON.parse(init.body as string)).toEqual({
      from: 'InTime <no-reply@acme.eu>',
      to: ['ada@acme.eu'],
      subject: 'Hello',
      text: 'Body with a link',
    });
  });

  it.each([400, 401, 422, 429, 500])('fails on HTTP %i without leaking data', async (status) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{"to":"ada@acme.eu","key":"re_key"}', { status }));
    const error = await new ResendMailer('re_key', 'a@b.eu', fetchMock).send(message).then(
      () => null,
      (e: Error) => e,
    );
    expect(error?.message).toBe(`Mail provider rejected the message (HTTP ${status})`);
    expect(error?.message).not.toMatch(/ada@acme\.eu|re_key/);
  });

  it('propagates network failures so the caller can retry', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('fetch failed'));
    await expect(new ResendMailer('k', 'a@b.eu', fetchMock).send(message)).rejects.toThrow(
      'fetch failed',
    );
  });
});
