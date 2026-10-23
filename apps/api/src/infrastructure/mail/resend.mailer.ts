import type { MailMessage, Mailer } from './mailer.js';

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

/** Delivers through Resend's HTTP API (no SMTP, so it works on hosts that block outbound mail ports). */
export class ResendMailer implements Mailer {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: MailMessage): Promise<void> {
    const response = await this.fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    // The error never repeats the response body or the recipient: both can contain personal data.
    if (!response.ok)
      throw new Error(`Mail provider rejected the message (HTTP ${response.status})`);
  }
}
