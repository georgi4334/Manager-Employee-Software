import { useMutation, useQueryClient } from '@tanstack/react-query';
import { eraseEmployee, fetchEmployeeExport, fetchOwnExport } from './api';
import { saveJson } from './download';

export function useDownloadOwnData() {
  return useMutation({
    mutationFn: async () => saveJson(await fetchOwnExport(), 'intime-data-export.json'),
  });
}

export function useDownloadEmployeeData(employeeId: string) {
  return useMutation({
    mutationFn: async () =>
      saveJson(await fetchEmployeeExport(employeeId), `intime-data-export-${employeeId}.json`),
  });
}

export function useEraseEmployee(employeeId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: () => eraseEmployee(employeeId),
    // The record now shows a placeholder everywhere (lists, details, leave, attendance).
    onSuccess: () => client.invalidateQueries(),
  });
}
