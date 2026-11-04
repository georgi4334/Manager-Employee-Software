import type { UpdateWorkspaceSettingsRequest, WorkspaceSettings } from '@intime/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authKeys } from '@/features/auth/api';
import { apiRequest } from '@/shared/api/client';

export const workspaceKeys = { settings: ['workspace', 'settings'] as const };

const fetchSettings = () => apiRequest<WorkspaceSettings>('/settings/workspace');
const saveSettings = (body: UpdateWorkspaceSettingsRequest) =>
  apiRequest<WorkspaceSettings>('/settings/workspace', { method: 'PUT', body });

export const useWorkspaceSettings = () =>
  useQuery({ queryKey: workspaceKeys.settings, queryFn: fetchSettings, retry: false });

/** The answer is the new settings; the signed-in user is reloaded so the new name shows at once. */
export function useSaveWorkspaceSettings() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: saveSettings,
    onSuccess: (settings) => {
      client.setQueryData(workspaceKeys.settings, settings);
      void client.invalidateQueries({ queryKey: authKeys.me });
    },
  });
}
