import { z } from 'zod';

/** Fixed providers with fixed base URLs: no custom URL means no server-side request forgery (ADR 0025). */
export const AI_PROVIDERS = ['groq', 'openrouter', 'mistral', 'gemini'] as const;
export type AiProvider = (typeof AI_PROVIDERS)[number];
export const AI_PROVIDER_BASE_URLS: Record<AiProvider, string> = {
  groq: 'https://api.groq.com/openai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  mistral: 'https://api.mistral.ai/v1',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai',
};

export const AI_LIMITS = {
  maxMessageLength: 2000,
  maxToolRounds: 4,
  toolResultMaxChars: 8000,
  messagesPerHour: 30,
  defaultRetentionDays: 90,
  maxRetentionDays: 365,
  /** Version of the notice a person accepts; raising it asks everybody again. */
  consentVersion: 1,
} as const;

/** Tools about the caller only, and tools that look up other people (behind `sharePeopleData`). */
export const AI_OWN_TOOLS = ['get_my_leave_balance', 'get_my_open_tasks', 'get_my_goals'] as const;
export const AI_PEOPLE_TOOLS = ['who_is_off', 'find_available_people'] as const;
export const AI_TOOL_NAMES = [...AI_OWN_TOOLS, ...AI_PEOPLE_TOOLS] as const;
export type AiToolName = (typeof AI_TOOL_NAMES)[number];

/** The tools the model is offered: tools about other people only when the person agreed to share such data. */
export const availableTools = (sharePeopleData: boolean): AiToolName[] =>
  sharePeopleData ? [...AI_TOOL_NAMES] : [...AI_OWN_TOOLS];

export type KeySource = 'user' | 'workspace';
/** The person's own key wins over the workspace key. */
export const resolveKeySource = (
  hasUserKey: boolean,
  hasWorkspaceKey: boolean,
): KeySource | null => (hasUserKey ? 'user' : hasWorkspaceKey ? 'workspace' : null);

/** Shortens a tool result so one answer cannot send an unbounded amount of data to a provider. */
export const truncateToolResult = (text: string, max: number = AI_LIMITS.toolResultMaxChars) =>
  text.length <= max ? text : `${text.slice(0, max)}…`;

export const isRateLimited = (messagesLastHour: number): boolean =>
  messagesLastHour >= AI_LIMITS.messagesPerHour;

/** The last four characters of a key, the only part that is ever shown again. */
export const keyLast4 = (apiKey: string): string => apiKey.slice(-4);

const model = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._:/-]*$/, 'invalid_model');
const apiKey = z
  .string()
  .trim()
  .min(8)
  .max(256)
  .regex(/^[\x21-\x7e]+$/, 'invalid_key');

export const aiKeyRequestSchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model,
  apiKey,
});
export type AiKeyRequest = z.infer<typeof aiKeyRequestSchema>;

export const aiConsentRequestSchema = z.object({
  accept: z.literal(true),
  sharePeopleData: z.boolean(),
});
export type AiConsentRequest = z.infer<typeof aiConsentRequestSchema>;

export const aiWorkspaceRequestSchema = z
  .object({
    enabled: z.boolean(),
    retentionDays: z.number().int().min(1).max(AI_LIMITS.maxRetentionDays),
  })
  .partial()
  .refine((v) => v.enabled !== undefined || v.retentionDays !== undefined, {
    error: 'empty_update',
  });
export type AiWorkspaceRequest = z.infer<typeof aiWorkspaceRequestSchema>;

export const aiChatRequestSchema = z.object({
  conversationId: z.uuid().optional(),
  message: z.string().trim().min(1).max(AI_LIMITS.maxMessageLength),
});
export type AiChatRequest = z.infer<typeof aiChatRequestSchema>;

export const aiCredentialSummarySchema = z.object({
  provider: z.enum(AI_PROVIDERS),
  model: z.string(),
  last4: z.string(),
});
export type AiCredentialSummary = z.infer<typeof aiCredentialSummarySchema>;

export const aiStatusSchema = z.object({
  /** Workspace switch. */
  enabled: z.boolean(),
  retentionDays: z.number().int(),
  /** The server can store keys (the master key is configured). */
  canStoreKeys: z.boolean(),
  consent: z.object({ accepted: z.boolean(), sharePeopleData: z.boolean() }),
  ownKey: aiCredentialSummarySchema.nullable(),
  /** Only for people who may manage the workspace key. */
  workspaceKey: aiCredentialSummarySchema.nullable(),
  /** Which key a message would use right now. */
  keySource: z.enum(['user', 'workspace']).nullable(),
  tools: z.array(z.enum(AI_TOOL_NAMES)),
});
export type AiStatus = z.infer<typeof aiStatusSchema>;

export const aiMessageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  toolsUsed: z.array(z.string()),
  createdAt: z.string(),
});
export type AiMessage = z.infer<typeof aiMessageSchema>;

export const aiChatResponseSchema = z.object({
  conversationId: z.uuid(),
  message: aiMessageSchema,
});
export type AiChatResponse = z.infer<typeof aiChatResponseSchema>;

export const aiConversationSummarySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  updatedAt: z.string(),
});
export const aiConversationListSchema = z.object({
  items: z.array(aiConversationSummarySchema),
});
export type AiConversationList = z.infer<typeof aiConversationListSchema>;

export const aiConversationSchema = aiConversationSummarySchema.extend({
  messages: z.array(aiMessageSchema),
});
export type AiConversation = z.infer<typeof aiConversationSchema>;

export const aiKeyTestSchema = z.object({ ok: z.boolean() });
