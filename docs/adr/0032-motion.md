# ADR 0032: Motion

Status: accepted

## Context

The app should feel like a phone app: panels glide, menus pop, tabs slide, a new notification
announces itself. It must stay fast on cheap phones, accessible, and testable.

## Decision

- **CSS only, no animation library.** Transitions and keyframes use `transform` and `opacity`
  (GPU friendly, no layout). Curves and durations are tokens in `styles/tokens.css`:
  `--ease-ios` (the iOS sheet curve), `--ease-spring` (a soft overshoot for pops),
  `--ease-standard` (One UI ease-out), `--dur-fast/base/sheet/exit`. Closing is always quicker
  than opening.
- **Enter and exit** use `usePresence(open, exitMs)` (`shared/lib/motion.ts`): the element mounts
  as `data-state="closed"`, becomes `open` two frames later, and stays mounted for the exit.
  The classes `motion-fade`, `motion-sheet-right`, `motion-sheet-up`, `motion-pop`, `motion-toast`
  (in `globals.css`) react to `data-state`. Used by the profile drawer, the phone "More" sheet, the
  theme menu, the date/time picker and the notification toast.
- **One-shot entrances** are keyframes: `motion-route` (a new page, keyed by pathname so tabs and
  filters of one page do not replay it), `motion-enter` (tab content, alerts, details content),
  `motion-stagger` (menu items), `motion-bell-ring` and `motion-badge-pop` (bell and badge).
- **Tabs** are `TabList`/`TabPanel` (`shared/ui/tabs.tsx`): a highlight that slides under the
  selected tab; new tab content fades up. Pages must not hand-write tab bars.
- **Notifications:** `NotificationToast` slides in when the unread count grows while the app is
  open (never on the first answer, never on the inbox page) and leaves after six seconds. It says
  only how many are new, never what.
- **Reduced motion:** `prefers-reduced-motion: reduce` switches every animation off in CSS and
  `usePresence` unmounts at once. Unit tests run without motion (`motionEnabled()` is false for
  `MODE=test`); the Playwright specs run with `reducedMotion: 'reduce'` so axe never scans a page
  mid-transition. `e2e/tests/07-motion.spec.ts` turns motion on and checks that the drawer, the
  sheet and the tab highlight really move.

## Consequences

A new popup, drawer or menu uses `usePresence` and a `motion-*` class instead of `{open && …}`
with nothing. Do not animate width, height, top or left.
