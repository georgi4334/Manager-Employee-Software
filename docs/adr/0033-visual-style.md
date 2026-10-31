# ADR 0033: Visual style

Status: accepted

## Decision

- **Shape:** a dark side panel (`--sidebar`) with the content on a white (light) or warm dark (dark)
  panel whose left corners are curved (`rounded-l-3xl`) and overlap it. Cards are outlined
  (`border-border`, almost no shadow) with `rounded-xl`; controls are `rounded-md` (about 12px);
  tabs are a bordered rounded bar with an orange pill. Radii are tokens (`--radius`, `-md … -3xl`).
- **Colour:** warm neutrals plus orange. `--primary` is a deep orange (`#c43c1a`) because white text
  on it must pass WCAG AA; `--brand` (`#f26a4b`) is the brighter orange for fills that carry no text
  (logo mark, active icon on the dark bottom bar). Secondary buttons are outlined.
- **Phone:** no side panel; the bottom bar is the dark panel with rounded top corners and the
  active entry in `--brand`. The profile button is an initials avatar (name and role from `md`).
- **Dark mode:** the side panel is the deepest tone (`#0d0807`), the content panel one step lighter
  (`#171110`) so the curve stays visible, cards a step above that (`#211918`). Orange becomes the
  lighter `#ff7a59` with dark text on it (7.5:1). Text is warm off-white, muted text `#b9aca7`.
- All pairs used for text were checked for AA contrast in both themes; the axe scans in
  `06-accessibility.spec.ts` stay the gate. Change colours only in `tokens.css`.

## Update: logo, splash and skeletons

- **Logo:** a `--brand` tile with a clock face open at the top; its dot doubles as the dot of the
  "i". `LogoMark` / `Logo` (`shared/ui/logo.tsx`) use tokens and are the only logo in the app
  (side panel, phone header, sign-in pages). `public/favicon.svg` is the same drawing with raw
  colours (a static file cannot read tokens); change both together.
- **Splash:** while the app asks who is signed in, `Splash` (`shared/components/Splash.tsx`) fills
  the screen with the dark panel, the mark, the name and a thin indeterminate bar (`role="status"`
  with a translated "Loading…"). A copy of the same markup sits inside `#root` in `index.html`
  (classes `splash-*` in `globals.css`), so the brand shows before the script has loaded and React
  replaces it without a jump. Reduced motion stops the animation.
- **Skeletons:** pages that load several cards at once (dashboard, analytics) show placeholder
  cards shaped like the real ones (`shared/ui/skeleton.tsx`: `SkeletonStatCard`, `SkeletonCard`,
  `SkeletonLines`) inside one `SkeletonGroup` (`role="status"`, sr-only "Loading…"); the shapes
  are `aria-hidden`. Dashboard widgets loading on their own show `SkeletonLines`. The `.skeleton`
  pulse is opacity only.

## Update: back navigation

- Every sub-page (employee, project, goal, review, 1:1 and role details, new role, the employee form,
  notification settings) starts with `BackLink` (`shared/ui/back-link.tsx`): an outlined pill with an
  arrow in an `--accent` circle, 44px high, above the heading. The arrow is decoration; the link's name
  is the text ("Back to projects"), so the texts carry no arrow characters.

## Update: buttons and drop-downs

- **Buttons:** `Button` is the only button. Filled variants (primary, danger) have a thin light line
  just inside the edge (`.btn-ring`: two inset shadows, the outer one in the fill colour `--btn-bg`, the
  inner one `--button-ring`), a soft shadow and semi-bold text; secondary is outlined with a faint
  `--accent` inner line. Hover brightens instead of changing the fill, so the ring stays aligned.
- **Drop-downs:** menus, the date/time picker, the theme menu and the profile drawer use `.menu-panel`
  (mostly white, fading into a light orange `--menu-to`, large soft shadow) and `.menu-item` (hover,
  focus and the current choice become a raised white pill with an orange glow, `--menu-item-glow`).
  Dark mode uses warm dark equivalents. Native `<select>`s stay native (phones keep their own picker);
  where the browser supports `appearance: base-select` (Chromium 135+), their open list gets the same
  panel, items, check mark and a chevron. Other browsers show their native list unchanged.

## Update: project and client cards

The Projects and Clients lists are card grids (one column on phones, two from `sm`), not stacked rows. A card has a soft
icon or initials tile (`Tile`), a short tag (`Chip`), the title, and a footer line with a person avatar and meta icons,
all from `shared/ui/tiles.tsx` and the existing tokens. The whole project card is the link; the card lifts
(`transform` only, `motion-safe`) on hover. Loading shows card-shaped skeletons. Health stays a word, never only a colour.

## Update: liquid glass containers

Every container that carries information (cards, list rows, stat tiles, the person and goal cards, board columns, the segmented
control, the week navigator, the back link, the notification toast) is a **frosted glass pane**: the `.glass` class in
`globals.css` (translucent `--glass-bg`, a light top highlight `--glass-highlight`, a hairline edge `--glass-edge`, a soft shadow
and `backdrop-filter: blur(18px) saturate(1.6)`); interactive panes add `.glass-hover`. The content panel is the canvas
(`.glass-canvas`): the page background with three very soft radial tints (`--canvas-1/2/3`: brand orange, cyan, green), so the blur
has something to show. Coloured left edges and borders still work on top (utilities override the component class).

- Readability first: the pane stays mostly opaque (64 % white in light, 58 % warm dark in dark), so the AA text pairs of the
  tokens still hold; the tints are faint.
- Without `backdrop-filter`, and for `prefers-reduced-transparency: reduce`, panes become solid (`--glass-solid`) and the canvas
  plain.
- Not glass: inputs, selects and alerts (they stay solid so typing is easy to read), drop-downs (`.menu-panel`), the month and time
  grids of the calendar (many small cells; blur would be costly) and the drawer controls.
- Colours live only in `tokens.css`, as before. `Card` uses `.glass`; new containers use `glass` (and `glass-hover` when they react
  to the pointer) instead of `border border-border bg-surface shadow-card`.

## Update: a boot screen without gaps

The boot screen in `index.html` carries its own small inline `<style>` (the `.splash` rules), because it is shown before any
stylesheet arrives; without it the first frames were an unstyled logo and text in the corner. Its colours repeat `--sidebar`,
`--sidebar-foreground`, `--sidebar-border` and `--brand`, and `src/app/splash-markup.test.ts` fails when they drift from
`tokens.css`. The app renders only once the translations are loaded (the static screen stays meanwhile), the `Suspense` fallback is
`Splash`, and the route guards (`RequireAuth`, `PublicOnly`) keep `Splash` on screen while they redirect, so no empty frame appears
between the boot screen and the first page.

## Update: four progress styles

Plain rounded bars said "how much" but not "against what". Each kind of progress now has one style, chosen by what it measures.
All are decoration: the numbers, the target and the state are always written next to them, and the shapes are `aria-hidden`
(or wrapped in a `role="progressbar"` with the value when the old bar had one).

- **Target line** (`TargetBar` in `shared/ui/progress.tsx`): a slim track with a fixed marker for the target; the fill stops at the
  marker or runs past it **striped** (`.bar-overflow`, in the fill colour), so "over" never relies on colour alone. The track ends a
  quarter past the target (`targetScale`); bars that are compared share one `scale`. Used for capacity (planned against available,
  per person and per day), project budgets in time reports and the attendance presence list.
- **Glass capsule** (`Capsule`): a frosted tube (`.capsule`, tokens `--capsule-*`) with a liquid fill (`.capsule-fill`, highlight on
  top) and the value inside it when it fits, else right after it. For the one number a card is about: goal and key-result progress,
  the leave balance (used and left). Solid fill with reduced transparency. Not for long lists.
- **Milestone track** (`MilestoneTrack` in `shared/ui/milestone-track.tsx`): dated points evenly spaced on a line with a **Today**
  pin that moves with the days between its two neighbours (`milestonePosition`). Points are done (filled green), late (red ring,
  with a note), next (orange ring) or upcoming; each states it in words (`common:milestone.*`). Side by side from `sm` for up to six
  points, otherwise a vertical list (always on phones). Used for the project timeline (start, milestones, end) and review cycle
  dates (period start/end, self and manager deadlines; a passed deadline with missing parts in an open cycle is late).
- **Day ribbon** (`features/attendance/DayRibbon.tsx`, pure `dayRibbon`): the day on a clock (07:00–19:00, widened to fit): worked
  blocks where they happened, dashed breaks, a Now line for an open record and a marker where the target is (or will be) reached.
  The line under it says the total, the breaks and the target time. Used on Attendance Today and in day cards. The presence list
  keeps the target line, because presence carries no times.
