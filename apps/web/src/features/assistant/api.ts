import type {
  AiChatResponse,
  AiConversation,
  AiConversationList,
  AiKeyRequest,
  AiStatus,
  AiWorkspaceRequest,
} from '@intime/contracts';
import { apiRequest } from '@/shared/api/client';

/** Everything under "ai" is user data: signing out removes it (see clearSession). */
export const aiKeys = {
  all: ['ai'] as const,
  status: ['ai', 'status'] as const,
  conversations: ['ai', 'conversations'] as const,
  conversation: (id: string) => ['ai', 'conversation', id] as const,
};

export type KeyScope = 'me' | 'workspace';

export const fetchStatus = () => apiRequest<AiStatus>('/ai/status');
export const acceptConsent = (sharePeopleData: boolean) =>
  apiRequest<AiStatus>('/ai/consent', { method: 'PUT', body: { accept: true, sharePeopleData } });
export const saveKey = (scope: KeyScope, body: AiKeyRequest) =>
  apiRequest<AiStatus>(`/ai/key/${scope}`, { method: 'PUT', body });
export const removeKey = (scope: KeyScope) =>
  apiRequest<AiStatus>(`/ai/key/${scope}`, { method: 'DELETE' });
export const testKey = (scope: KeyScope) =>
  apiRequest<{ ok: boolean }>(`/ai/key/${scope}/test`, { method: 'POST' });
export const saveWorkspace = (body: AiWorkspaceRequest) =>
  apiRequest<AiStatus>('/ai/workspace', { method: 'PUT', body });
export const sendMessage = (message: string, conversationId: string | null) =>
  apiRequest<AiChatResponse>('/ai/chat', {
    method: 'POST',
    body: { message, ...(conversationId ? { conversationId } : {}) },
  });
export const fetchConversations = () => apiRequest<AiConversationList>('/ai/conversations');
export const fetchConversation = (id: string) =>
  apiRequest<AiConversation>(`/ai/conversations/${id}`);
export const deleteConversation = (id: string) =>
  apiRequest(`/ai/conversations/${id}`, { method: 'DELETE' });
