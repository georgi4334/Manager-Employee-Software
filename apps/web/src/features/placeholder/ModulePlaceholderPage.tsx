import { Card } from '@/shared/ui/card';

export function ModulePlaceholderPage({ title }: { title: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <Card>
        <p className="text-sm text-muted-foreground">This module is coming soon.</p>
      </Card>
    </div>
  );
}
