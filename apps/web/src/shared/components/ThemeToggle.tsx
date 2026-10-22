import { Monitor, Moon, Sun } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { useThemeStore, type ThemePreference } from '@/shared/stores/theme.store';

const ORDER: ThemePreference[] = ['light', 'dark', 'system'];
const ICONS = { light: Sun, dark: Moon, system: Monitor } as const;

export function ThemeToggle() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length] ?? 'system';
  const Icon = ICONS[preference];

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Theme: ${preference}. Switch to ${next}`}
      onClick={() => setPreference(next)}
    >
      <Icon className="size-5" aria-hidden="true" />
    </Button>
  );
}
