import { create } from 'zustand';

export const SIDEBAR_STORAGE_KEY = 'intime.sidebar';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === 'collapsed';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? 'collapsed' : 'expanded');
  } catch {
    // Storage can be blocked (private mode); the choice then lasts for this session only.
  }
}

interface SidebarState {
  /** The desktop menu shows icons only (docs/adr/0042-collapsible-sidebar.md). Phones never use it. */
  collapsed: boolean;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  collapsed: readCollapsed(),
  toggle: () => {
    const collapsed = !get().collapsed;
    writeCollapsed(collapsed);
    set({ collapsed });
  },
}));

/** Reads the stored choice again (tests reset storage between cases). */
export function reloadSidebarState(): void {
  useSidebarStore.setState({ collapsed: readCollapsed() });
}
