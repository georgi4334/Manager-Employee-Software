import type { ReactNode } from 'react';
import { Card, CardTitle } from '@/shared/ui/card';

export function InvalidLinkCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="space-y-3 text-center">
      <CardTitle className="text-xl">{title}</CardTitle>
      {children}
    </Card>
  );
}
