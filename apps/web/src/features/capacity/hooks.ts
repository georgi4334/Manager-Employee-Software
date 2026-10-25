import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { capacityKeys, fetchCapacity, type CapacityParams } from './api';

export const useCapacity = (params: CapacityParams) =>
  useQuery({
    queryKey: capacityKeys.list(params),
    queryFn: () => fetchCapacity(params),
    placeholderData: keepPreviousData,
    retry: false,
  });
