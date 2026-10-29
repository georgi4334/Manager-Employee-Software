import { Suspense, useState } from 'react';
import { RouterProvider } from 'react-router';
import { Splash } from '@/shared/components/Splash';
import { Providers } from './providers';
import { createAppRouter } from './router';

export function App() {
  const [router] = useState(createAppRouter);
  return (
    <Providers>
      {/* While a page's code loads, the boot screen stays instead of a blank page between two splashes. */}
      <Suspense fallback={<Splash />}>
        <RouterProvider router={router} />
      </Suspense>
    </Providers>
  );
}
