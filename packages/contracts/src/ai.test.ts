import { describe, expect, it } from 'vitest';
import {
  AI_LIMITS,
  AI_OWN_TOOLS,
  AI_PROVIDERS,
  AI_PROVIDER_BASE_URLS,
  AI_TOOL_NAMES,
  aiChatRequestSchema,
  aiConsentRequestSchema,
  aiKeyRequestSchema,
  aiWorkspaceRequestSchema,
  availableTools,
  isRateLimited,
  keyLast4,
  resolveKeySource,
  truncateToolResult,
} from './ai.js';

describe('providers', () => {
  it('has a fixed https base URL for every provider and nothing else', () => {
    for (const p of AI_PROVIDERS) expect(AI_PROVIDER_BASE_URLS[p]).toMatch(/^https:\/\//);
    expect(Object.keys(AI_PROVIDER_BASE_URLS).sort()).toEqual([...AI_PROVIDERS].sort());
  });
});

describe('availableTools', () => {
  it('offers only tools about the caller until people data may be shared', () => {
    expect(availableTools(false)).toEqual([...AI_OWN_TOOLS]);
    expect(availableTools(true)).toEqual([...AI_TOOL_NAMES]);
    expect(availableTools(false)).not.toContain('who_is_off');
  });
});

describe('resolveKeySource', () => {
  it('prefers the own key, falls back to the workspace key, else none', () => {
    expect(resolveKeySource(true, true)).toBe('user');
    expect(resolveKeySource(false, true)).toBe('workspace');
    expect(resolveKeySource(true, false)).toBe('user');
    expect(resolveKeySource(false, false)).toBeNull();
  });
});

describe('limits', () => {
  it('truncates long tool results and keeps short ones', () => {
    expect(truncateToolResult('abc', 5)).toBe('abc');
    expect(truncateToolResult('abcde', 5)).toBe('abcde');
    expect(truncateToolResult('abcdef', 5)).toBe('abcde…');
  });
  it('limits messages per hour at the boundary', () => {
    expect(isRateLimited(AI_LIMITS.messagesPerHour - 1)).toBe(false);
    expect(isRateLimited(AI_LIMITS.messagesPerHour)).toBe(true);
  });
  it('shows only the last four characters of a key', () => {
    expect(keyLast4('sk-abcdef1234')).toBe('1234');
  });
});

describe('aiKeyRequestSchema', () => {
  const ok = { provider: 'groq', model: 'llama-3.3-70b-versatile', apiKey: 'gsk_abcdefgh1234' };
  it('accepts a normal request and trims', () => {
    expect(aiKeyRequestSchema.safeParse(ok).success).toBe(true);
    expect(aiKeyRequestSchema.parse({ ...ok, apiKey: `  ${ok.apiKey}  ` }).apiKey).toBe(ok.apiKey);
    expect(aiKeyRequestSchema.safeParse({ ...ok, model: 'meta-llama/llama-3:free' }).success).toBe(
      true,
    );
  });
  it.each([
    ['unknown provider', { ...ok, provider: 'evil' }],
    ['short key', { ...ok, apiKey: 'short' }],
    ['key with spaces', { ...ok, apiKey: 'abcd efgh ijkl' }],
    ['key with line break', { ...ok, apiKey: 'abcdefgh\nijkl' }],
    ['overlong key', { ...ok, apiKey: 'a'.repeat(257) }],
    ['model with URL', { ...ok, model: 'http://evil.example/x' }],
    ['model with space', { ...ok, model: 'a b' }],
    ['empty model', { ...ok, model: '' }],
    ['missing provider', { model: ok.model, apiKey: ok.apiKey }],
  ])('refuses %s', (_name, body) => {
    expect(aiKeyRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('aiConsentRequestSchema', () => {
  it('needs an explicit acceptance', () => {
    expect(aiConsentRequestSchema.safeParse({ accept: true, sharePeopleData: false }).success).toBe(
      true,
    );
    expect(
      aiConsentRequestSchema.safeParse({ accept: false, sharePeopleData: false }).success,
    ).toBe(false);
    expect(aiConsentRequestSchema.safeParse({ sharePeopleData: true }).success).toBe(false);
  });
});

describe('aiWorkspaceRequestSchema', () => {
  it('accepts one or both fields within the retention range', () => {
    expect(aiWorkspaceRequestSchema.safeParse({ enabled: true }).success).toBe(true);
    expect(aiWorkspaceRequestSchema.safeParse({ retentionDays: 1 }).success).toBe(true);
    expect(aiWorkspaceRequestSchema.safeParse({ retentionDays: 365, enabled: false }).success).toBe(
      true,
    );
  });
  it.each([
    {},
    { retentionDays: 0 },
    { retentionDays: 366 },
    { retentionDays: 1.5 },
    { enabled: 'yes' },
  ])('refuses %j', (body) => {
    expect(aiWorkspaceRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('aiChatRequestSchema', () => {
  it('trims and limits the message', () => {
    expect(aiChatRequestSchema.parse({ message: '  hi  ' }).message).toBe('hi');
    expect(
      aiChatRequestSchema.safeParse({ message: 'a'.repeat(AI_LIMITS.maxMessageLength) }).success,
    ).toBe(true);
    expect(
      aiChatRequestSchema.safeParse({ message: 'a'.repeat(AI_LIMITS.maxMessageLength + 1) })
        .success,
    ).toBe(false);
    expect(aiChatRequestSchema.safeParse({ message: '   ' }).success).toBe(false);
    expect(aiChatRequestSchema.safeParse({ message: 'x', conversationId: 'nope' }).success).toBe(
      false,
    );
  });
});
