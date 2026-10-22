import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockMatchMedia } from '@/tests/setup';
import {
  THEME_STORAGE_KEY,
  applyTheme,
  parseThemePreference,
  resolveTheme,
  useThemeStore,
} from './theme.store';

describe('parseThemePreference', () => {
  it.each(['light', 'dark', 'system'])('keeps valid value %s', (value) => {
    expect(parseThemePreference(value)).toBe(value);
  });

  it.each([null, undefined, '', 'DARK', 'blue', 1, {}])('falls back to system for %p', (value) => {
    expect(parseThemePreference(value)).toBe('system');
  });
});

describe('resolveTheme', () => {
  it('follows the OS when preference is system', () => {
    expect(resolveTheme('system', true)).toBe('dark');
    expect(resolveTheme('system', false)).toBe('light');
  });

  it('ignores the OS when the user chose explicitly', () => {
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme('dark', false)).toBe('dark');
  });
});

describe('theme store', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockMatchMedia(false);
  });

  it('applies and persists a chosen theme', () => {
    useThemeStore.getState().setPreference('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    expect(useThemeStore.getState().preference).toBe('dark');
  });

  it('applies the OS theme for system preference', () => {
    mockMatchMedia(true);
    applyTheme('system');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('still switches theme when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => useThemeStore.getState().setPreference('light')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
