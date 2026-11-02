import type { EmployeeList, ProjectList, TaskList } from '@intime/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { usePermission } from '@/features/auth/permissions';
import { apiRequest } from '@/shared/api/client';

/** Results per kind, the delay after typing and the shortest query that is sent. */
export const REMOTE_LIMIT = 5;
export const REMOTE_DELAY_MS = 250;
export const REMOTE_MIN_CHARS = 2;

const list = (path: string, q: string, extra: Record<string, string>) =>
  `${path}?${new URLSearchParams({ q, page: '1', pageSize: String(REMOTE_LIMIT), ...extra })}`;

export const searchKeys = {
  people: (q: string) => ['palette', 'people', q] as const,
  projects: (q: string) => ['palette', 'projects', q] as const,
  tasks: (q: string) => ['palette', 'tasks', q] as const,
};

/** The typed text after a short pause, or '' while it is too short to send. */
export function useDebouncedQuery(text: string): string {
  const [value, setValue] = useState('');
  useEffect(() => {
    const trimmed = text.trim();
    const timer = setTimeout(
      () => setValue(trimmed.length >= REMOTE_MIN_CHARS ? trimmed : ''),
      REMOTE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [text]);
  return value;
}

/**
 * People, projects and tasks through the existing scoped list endpoints, each only with the permission of its page
 * (docs/adr/0039-command-palette.md). The API decides what comes back.
 */
export function useRemoteSearch(q: string) {
  const canPeople = usePermission('employee.view_directory');
  const canProjects = usePermission('project.view');
  const canTasks = usePermission('task.view');
  const opts = { staleTime: 30_000, retry: false } as const;
  const people = useQuery({
    queryKey: searchKeys.people(q),
    queryFn: () => apiRequest<EmployeeList>(list('/employees', q, { status: 'active' })),
    enabled: q !== '' && canPeople,
    ...opts,
  });
  const projects = useQuery({
    queryKey: searchKeys.projects(q),
    queryFn: () => apiRequest<ProjectList>(list('/projects', q, { status: 'all' })),
    enabled: q !== '' && canProjects,
    ...opts,
  });
  const tasks = useQuery({
    queryKey: searchKeys.tasks(q),
    queryFn: () => apiRequest<TaskList>(list('/tasks', q, { status: 'all', type: 'all' })),
    enabled: q !== '' && canTasks,
    ...opts,
  });
  const all = [people, projects, tasks];
  return {
    people: people.data?.items ?? [],
    projects: projects.data?.items ?? [],
    tasks: tasks.data?.items ?? [],
    searching: all.some((query) => query.isFetching),
    failed: all.some((query) => query.isError),
  };
}
