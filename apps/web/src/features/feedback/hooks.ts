import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  feedbackKeys,
  fetchFeedback,
  giveFeedback,
  keepFeedback,
  removeFeedback,
  reportFeedback,
  type ListParams,
} from './api';

export const useFeedback = (params: ListParams, enabled = true) =>
  useQuery({
    queryKey: feedbackKeys.list(params),
    queryFn: () => fetchFeedback(params),
    placeholderData: keepPreviousData,
    enabled,
    retry: false,
  });

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: feedbackKeys.all });
}

export function useGiveFeedback() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: giveFeedback, onSuccess: refresh });
}
export function useRemoveFeedback() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: removeFeedback, onSuccess: refresh });
}
export function useReportFeedback() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: reportFeedback, onSuccess: refresh });
}
export function useKeepFeedback() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: keepFeedback, onSuccess: refresh });
}
