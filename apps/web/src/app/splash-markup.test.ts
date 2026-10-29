import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// The boot screen in index.html is styled inline (it shows before any stylesheet); its colours must stay the tokens'.
const html = readFileSync(resolve(__dirname, '../../index.html'), 'utf8');
const tokens = readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8');
const lightBlock = tokens.slice(tokens.indexOf(':root'), tokens.indexOf("[data-theme='dark']"));
const token = (name: string) => {
  const match = new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(lightBlock);
  if (!match?.[1]) throw new Error(`token ${name} not found`);
  return match[1].toLowerCase();
};
const style = /<style>([\s\S]*?)<\/style>/.exec(html)?.[1] ?? '';

describe('the static boot screen', () => {
  it('carries its own styles, so it never shows unstyled before the stylesheet', () => {
    for (const rule of [
      '.splash {',
      '.splash-mark {',
      '.splash-bar::after {',
      '@keyframes splash-bar',
    ]) {
      expect(style).toContain(rule);
    }
    expect(style).toContain('position: fixed');
    expect(style).toContain('prefers-reduced-motion');
  });

  it('uses the same colours as the design tokens', () => {
    const used = new Set((style.match(/#[0-9a-f]{6}/gi) ?? []).map((c) => c.toLowerCase()));
    const allowed = new Set(
      ['sidebar', 'sidebar-foreground', 'sidebar-border', 'brand'].map(token),
    );
    expect([...used].filter((c) => !allowed.has(c))).toEqual([]);
    for (const name of ['sidebar', 'sidebar-foreground', 'brand']) {
      expect(used).toContain(token(name));
    }
  });

  it('draws the same mark as the app', () => {
    expect(html).toContain('class="splash"');
    expect(html).toContain('class="splash-mark"');
    expect(html).toContain('class="splash-bar"');
  });
});
