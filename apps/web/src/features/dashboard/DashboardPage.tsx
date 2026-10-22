import { Card, CardTitle } from '@/shared/ui/card';

export function DashboardPage() {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Card>
          <CardTitle>Welcome to InTime</CardTitle>
          <p className="mt-2 text-sm text-muted-foreground">
            Your employee management workspace is being set up.
          </p>
        </Card>
      </div>
    </div>
  );
}
