import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AiStatus } from '@intime/contracts';
import {
  acceptConsent,
  aiKeys,
  deleteConversation,
  fetchConversation,
  fetchConversations,
  fetchStatus,
  removeKey,
  saveKey,
  saveWorkspace,
  sendMessage,
  testKey,
  type KeyScope,
} from './api';

export const useAiStatus = () =>
  useQuery({ queryKey: aiKeys.status, queryFn: fetchStatus, retry: false });
export const useConversations = (enabled = true) =>
  useQuery({
    queryKey: aiKeys.conversations,
    queryFn: fetchConversations,
    enabled,
    retry: false,
  });
export const useConversation = (id: string | null) =>
  useQuery({
    queryKey: aiKeys.conversation(id ?? ''),
    queryFn: () => fetchConversation(id ?? ''),
    enabled: id !== null,
    retry: false,
  });

/** Mutations that answer with the new status put it straight into the cache. */
function useStatusMutation<V>(fn: (v: V) => Promise<AiStatus>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (status) => client.setQueryData(aiKeys.status, status),
  });
}

export const useConsent = () => useStatusMutation(acceptConsent);
export const useSaveKey = (scope: KeyScope) =>
  useStatusMutation((body: Parameters<typeof saveKey>[1]) => saveKey(scope, body));
export const useRemoveKey = (scope: KeyScope) => useStatusMutation(() => removeKey(scope));
export const useSaveWorkspace = () => useStatusMutation(saveWorkspace);
export const useTestKey = (scope: KeyScope) => useMutation({ mutationFn: () => testKey(scope) });

export function useSend() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ message, conversationId }: { message: string; conversationId: string | null }) =>
      sendMessage(message, conversationId),
    onSuccess: (reply) => {
      void client.invalidateQueries({ queryKey: aiKeys.conversations });
      void client.invalidateQueries({ queryKey: aiKeys.conversation(reply.conversationId) });
    },
  });
}

export function useDeleteConversation() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: deleteConversation,
    onSuccess: () => client.invalidateQueries({ queryKey: aiKeys.conversations }),
  });
}
