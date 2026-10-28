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
