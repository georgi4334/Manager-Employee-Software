import type { QueryClient } from '@tanstack/react-query';
import { render, waitFor, type RenderResult } from '@testing-library/react';
import { RouterProvider } from 'react-router';
import { Providers, createQueryClient } from '@/app/providers';
import { createTestRouter } from '@/app/router';

export interface RenderAppOptions {
  client?: QueryClient;
  /** Router entries; the last one is the current page. Use to give a page "history" (state.from). */
  entries?: (string | { pathname: string; state?: unknown })[];
}

/** Renders the whole app at a path and waits until the first requests (who is signed in) are done. */
export async function renderApp(
  path = '/',
  { client = createQueryClient(), entries }: RenderAppOptions = {},
): Promise<RenderResult & { client: QueryClient; router: ReturnType<typeof createTestRouter> }> {
  const router = createTestRouter(entries ?? [path]);
  const result = render(
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>,
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  return { ...result, client, router };
}
