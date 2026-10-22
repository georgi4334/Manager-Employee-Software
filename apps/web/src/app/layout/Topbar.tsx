import { ThemeToggle } from '@/shared/components/ThemeToggle';

export function Topbar() {
  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-surface px-4 md:px-6">
      <span className="text-lg font-bold text-primary md:hidden">InTime</span>
      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
      </div>
    </header>
  );
}
