import { Injectable } from '@nestjs/common';
import { AI_PROVIDER_BASE_URLS, type AiProvider } from '@intime/contracts';
import { AppException } from '../../common/errors/app-exception.js';

export interface ProviderToolCall {
  id: string;
  name: string;
  /** JSON text as sent by the model. */
  arguments: string;
}

export type ProviderMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ProviderToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ProviderTool {
  name: string;
  description: string;
  /** JSON schema of the arguments. */
  parameters: Record<string, unknown>;
}

export interface ProviderRequest {
  provider: AiProvider;
  model: string;
  apiKey: string;
  messages: ProviderMessage[];
  tools?: ProviderTool[];
  maxTokens?: number;
}

export interface ProviderReply {
  content: string | null;
  toolCalls: ProviderToolCall[];
}

/** The seam to the AI provider: tests replace it, so no test reaches a real provider. */
export abstract class AiProviderClient {
  abstract complete(request: ProviderRequest): Promise<ProviderReply>;
}

const TIMEOUT_MS = 30_000;

const providerError = (reason: string) =>
  new AppException('AI_PROVIDER_ERROR', {
    message: 'The AI provider could not answer',
    params: { reason },
  });

/** OpenAI-compatible chat completions against the fixed base URL of the chosen provider. */
@Injectable()
export class HttpAiProviderClient extends AiProviderClient {
  async complete(request: ProviderRequest): Promise<ProviderReply> {
    const url = `${AI_PROVIDER_BASE_URLS[request.provider]}/chat/completions`;
    const body = {
      model: request.model,
      max_tokens: request.maxTokens ?? 800,
      messages: request.messages.map((m) => {
        if (m.role === 'tool') {
          return { role: 'tool', tool_call_id: m.toolCallId, content: m.content };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'assistant',
            content: m.content,
            tool_calls: m.toolCalls.map((c) => ({
              id: c.id,
              type: 'function',
              function: { name: c.name, arguments: c.arguments },
            })),
          };
        }
        return { role: m.role, content: m.content };
      }),
      ...(request.tools?.length
        ? {
            tools: request.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    };

    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${request.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
      });
    } catch (error) {
      throw providerError(
        error instanceof Error && error.name === 'TimeoutError' ? 'timeout' : 'network',
      );
    }
    // Never forward the provider's text: it may echo the prompt or the key.
    if (!response.ok) {
      throw providerError(
        response.status === 401 || response.status === 403
          ? 'rejected_key'
          : response.status === 429
            ? 'provider_rate_limited'
            : response.status >= 500
              ? 'provider_down'
              : 'bad_request',
      );
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw providerError('bad_response');
    }
    const message = (
      json as {
        choices?: {
          message?: {
            content?: string | null;
            tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
          };
        }[];
      }
    ).choices?.[0]?.message;
    if (!message) throw providerError('bad_response');
    return {
      content: typeof message.content === 'string' ? message.content : null,
      toolCalls: (message.tool_calls ?? []).flatMap((c, index) =>
        c.function?.name
          ? [
              {
                id: c.id ?? `call_${index}`,
                name: c.function.name,
                arguments: c.function.arguments ?? '{}',
              },
            ]
          : [],
      ),
    };
  }
}
