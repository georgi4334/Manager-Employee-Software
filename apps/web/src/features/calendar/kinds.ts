import type { ItemKind } from './items';

/** The small dot of a kind (legend, month cells, cards). */
export const KIND_DOT: Record<ItemKind, string> = {
  personal: 'bg-primary',
  team: 'bg-info',
  company: 'bg-success',
  leave: 'bg-warning',
  holiday: 'bg-accent-foreground',
};

/** Edge and date colour per kind (text colours are the AA-checked tokens). */
export const KIND_ACCENT: Record<ItemKind, { edge: string; text: string }> = {
  personal: { edge: 'border-l-primary', text: 'text-primary' },
  team: { edge: 'border-l-info', text: 'text-info' },
  company: { edge: 'border-l-success', text: 'text-success' },
  leave: { edge: 'border-l-warning', text: 'text-warning' },
  holiday: { edge: 'border-l-accent-foreground', text: 'text-accent-foreground' },
};
