# ADR 0042: Collapsible side menu

Status: accepted (2026-11-03)

## Context

The desktop side menu (ADR 0037) is 16rem wide. On a laptop screen that width is taken from boards, calendars and
capacity cards all day, although people who know the app navigate by icon. A menu that folds to an icon rail is the
usual answer; it must keep the menu fully usable by keyboard and screen reader.

## Decision

- **Web only, a personal display choice.** A button at the top of the menu ("Collapse menu" / "Expand menu") switches
  between the full menu and a 4.75rem icon rail. The choice is kept in the browser (`localStorage` key
  `intime.sidebar`, values `collapsed` / `expanded`, read and written in `try/catch`; anything else means expanded).
  It is not personal data and is never sent to the server. Phones are unchanged (bottom bar, ADR 0037).
- **State**: a Zustand store (`shared/stores/sidebar.store.ts`). `AppShell` sets `--sidebar-w` on the shell and uses
  it as the grid column, so fixed bars beside the menu (the inbox bulk bar) follow it.
- **The rail**: the logo mark (the name stays as screen-reader text), one icon per entry, group headings become a thin
  divider but stay as the lists' names (`sr-only`), the page sections under the open entry are left to the page's own
  tabs, and the "Waiting for me" total is a small number on the icon (words for screen readers as before).
- **Accessibility**: every link keeps its label as its accessible name (`sr-only`), so the current page
  (`aria-current`) and the tests by name work in both states. The label also appears beside the icon on hover **and**
  keyboard focus as a tooltip (portalled and fixed, since the scrolling menu would clip it; `aria-hidden`, dismissed
  with Escape, WCAG 1.4.13). The toggle is a 44px button whose name says what it does.
- **Motion** (ADR 0032): the width change is not animated (never animate width); it switches at once.

## Consequences

- The axe scan covers the collapsed menu with a tooltip open on desktop; `e2e/tests/05-sidebar.spec.ts` checks
  width, tooltip, navigation and that the choice survives a reload.
- Keyboard shortcut for the toggle, per-workspace defaults and a hover-to-peek menu are out of scope.
