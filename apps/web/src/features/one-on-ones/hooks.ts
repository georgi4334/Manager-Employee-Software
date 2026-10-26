import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addActionItem,
  createMeeting,
  fetchMeeting,
  fetchMeetings,
  fetchPeople,
  meetingKeys,
  removeActionItem,
  updateActionItem,
  updateMeeting,
  type ListParams,
} from './api';

export const useMeetings = (params: ListParams) =>
  useQuery({
    queryKey: meetingKeys.list(params),
    queryFn: () => fetchMeetings(params),
    placeholderData: keepPreviousData,
    retry: false,
  });

export const useMeeting = (id: string) =>
  useQuery({ queryKey: meetingKeys.detail(id), queryFn: () => fetchMeeting(id), retry: false });

export const useMeetingPeople = () =>
  useQuery({ queryKey: meetingKeys.people, queryFn: fetchPeople, retry: false });

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: meetingKeys.all });
}

export function useCreateMeeting() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createMeeting, onSuccess: refresh });
}
export function useUpdateMeeting(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateMeeting>[1]) => updateMeeting(id, body),
    onSuccess: refresh,
  });
}
export function useAddActionItem(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof addActionItem>[1]) => addActionItem(id, body),
    onSuccess: refresh,
  });
}
export function useUpdateActionItem(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: ({
      itemId,
      body,
    }: {
      itemId: string;
      body: Parameters<typeof updateActionItem>[2];
    }) => updateActionItem(id, itemId, body),
    onSuccess: refresh,
  });
}
export function useRemoveActionItem(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (itemId: string) => removeActionItem(id, itemId),
    onSuccess: refresh,
  });
}
