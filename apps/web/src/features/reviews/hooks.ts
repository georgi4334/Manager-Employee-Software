import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addCompetency,
  calibrate,
  createCycle,
  deleteCycle,
  fetchCycles,
  fetchReview,
  fetchReviews,
  moveCycle,
  removeCompetency,
  reopen,
  reviewKeys,
  saveManager,
  saveSelf,
  submitManager,
  submitSelf,
  updateCycle,
  type ListParams,
} from './api';

export const useCycles = (enabled = true) =>
  useQuery({ queryKey: reviewKeys.cycles, queryFn: fetchCycles, enabled, retry: false });
export const useReviews = (params: ListParams, enabled = true) =>
  useQuery({
    queryKey: reviewKeys.list(params),
    queryFn: () => fetchReviews(params),
    placeholderData: keepPreviousData,
    enabled,
    retry: false,
  });
export const useReview = (id: string) =>
  useQuery({ queryKey: reviewKeys.detail(id), queryFn: () => fetchReview(id), retry: false });

function useRefresh() {
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: reviewKeys.all });
}

export function useCreateCycle() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: createCycle, onSuccess: refresh });
}
export function useUpdateCycle(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof updateCycle>[1]) => updateCycle(id, body),
    onSuccess: refresh,
  });
}
export function useDeleteCycle() {
  const refresh = useRefresh();
  return useMutation({ mutationFn: deleteCycle, onSuccess: refresh });
}
export function useAddCompetency(cycleId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (body: Parameters<typeof addCompetency>[1]) => addCompetency(cycleId, body),
    onSuccess: refresh,
  });
}
export function useRemoveCompetency(cycleId: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (id: string) => removeCompetency(cycleId, id),
    onSuccess: refresh,
  });
}
export function useMoveCycle(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (step: Parameters<typeof moveCycle>[1]) => moveCycle(id, step),
    onSuccess: refresh,
  });
}

export function useWriteSelf(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async ({
      body,
      submit,
    }: {
      body: Parameters<typeof saveSelf>[1];
      submit: boolean;
    }) => {
      const saved = await saveSelf(id, body);
      return submit ? submitSelf(id) : saved;
    },
    onSuccess: refresh,
  });
}
export function useWriteManager(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: async ({
      body,
      submit,
    }: {
      body: Parameters<typeof saveManager>[1];
      submit: boolean;
    }) => {
      const saved = await saveManager(id, body);
      return submit ? submitManager(id) : saved;
    },
    onSuccess: refresh,
  });
}
export function useCalibrate(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (rating: number | null) => calibrate(id, { rating }),
    onSuccess: refresh,
  });
}
export function useReopen(id: string) {
  const refresh = useRefresh();
  return useMutation({
    mutationFn: (part: 'self' | 'manager') => reopen(id, { part }),
    onSuccess: refresh,
  });
}
