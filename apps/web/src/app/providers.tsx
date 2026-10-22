import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState, type ReactNode } from 'react';
import { clearSession } from '@/features/auth/session';
import { setSessionExpiredHandler } from '@/shared/api/client';
import { WakingUpBanner } from '@/shared/components/WakingUpBanner';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false } },
  });
}

export function Providers({
  children,
  client: given,
}: {
  children: ReactNode;
  client?: QueryClient;
}) {
  const [created] = useState(createQueryClient);
  const client = given ?? created;

  // When the API says the session is gone and cannot be refreshed, forget the user: the route guard
  // then sends them to the login page.
  useEffect(() => {
    setSessionExpiredHandler(() => clearSession(client));
    return () => setSessionExpiredHandler(undefined);
  }, [client]);

  return (
    <QueryClientProvider client={client}>
      <WakingUpBanner />
      {children}
    </QueryClientProvider>
  );
}
