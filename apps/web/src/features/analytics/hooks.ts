import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { analyticsKeys, fetchAnalytics } from './api';

export const useAnalytics = (from: string, to: string) =>
  useQuery({
    queryKey: analyticsKeys.overview(from, to),
    queryFn: () => fetchAnalytics(from, to),
    placeholderData: keepPreviousData,
    retry: false,
  });
