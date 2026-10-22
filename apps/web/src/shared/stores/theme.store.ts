import { create } from 'zustand';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'intime.theme';

export function parseThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function writeStoredPreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Storage can be blocked (private mode); the preference then lasts for this session only.
  }
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(preference: ThemePreference): void {
  document.documentElement.dataset.theme = resolveTheme(preference, darkQuery().matches);
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const useThemeStore = create<ThemeState>((set) => ({
  preference: readStoredPreference(),
  setPreference: (preference) => {
    writeStoredPreference(preference);
    applyTheme(preference);
    set({ preference });
  },
}));

/** Applies the stored theme and follows OS changes while the preference is "system". */
export function initTheme(): () => void {
  applyTheme(useThemeStore.getState().preference);
  const query = darkQuery();
  const onChange = () => {
    if (useThemeStore.getState().preference === 'system') applyTheme('system');
  };
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
