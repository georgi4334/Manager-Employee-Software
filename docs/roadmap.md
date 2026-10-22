# InTime — Roadmap & Working Agreement

Solo developer + Claude, ~3–4 focused hours/day. Estimates are in **working days** (1 day ≈ 3–4 h) and assume steady progress; treat them as a guide, not a promise.

## Git workflow
- `main` — always deployable; updated only through a PR from `dev`.
- `dev` — integration branch; all feature work lands here (feature branches off `dev` are optional for bigger changes: `feat/<module>-<topic>` → PR into `dev`).
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- CI on every push/PR: lint → typecheck → unit tests → build. PR into `main` additionally runs integration + E2E.
- Recommended GitHub settings: protect `main` (require PR + passing CI), no direct pushes.

## Definition of Done (every feature)
- [ ] Unit tests: **positive and negative** (invalid input, forbidden role, wrong tenant, not found, duplicates, boundaries).
- [ ] Permission checks covered by the matrix test.
- [ ] Mobile-responsive (375 px) and no hard-coded colors (design tokens only).
- [ ] All strings translated: EN, DE, BG.
- [ ] Notifications/audit events emitted where relevant.
- [ ] GDPR check: personal data minimal, export/erase covered.
- [ ] Docs/ADR updated if a decision was made.

## Phase 0 — Foundation (~10–12 days)
1. Monorepo (pnpm + Turborepo), TS config, ESLint/Prettier, Husky + commitlint, GitHub Actions. *(1–2 d)*
2. `apps/web`: Vite + React 19 + React Router v7, Tailwind with `tokens.css` (neutral placeholder palette, light/dark), shadcn/ui base components, app shell (sidebar / mobile bottom nav), Vitest + RTL + MSW. *(2–3 d)*
3. i18n: react-i18next, EN/DE/BG namespaces, language switcher, missing-key check in CI. *(1 d)*
4. `apps/api`: NestJS, config validation, Prisma + Postgres (docker-compose locally), health check, error format with codes, OpenAPI. *(2 d)*
5. Tenancy: tenant context + RLS migration + isolation tests. *(1–2 d)*
6. Auth: email/password (argon2id), Google OAuth, refresh rotation, invitations, password reset, throttling. *(3 d)*
7. RBAC: roles/permissions seed from `packages/contracts`, guard, policies, matrix test. *(2 d)*
8. Notification skeleton (outbox → pg-boss → in-app + email) *(can slip into Phase 1 alongside Leave)*.
9. Deploy pipeline to free EU hosting + "API waking up" UI state. *(1–2 d)*

## Phase 1 — First release (~25–30 days)
| Module | Scope | Est. |
|---|---|---|
| Employees | CRUD, directory, profile, invite flow, avatar upload | 4–5 d |
| Organization | departments, teams, reporting lines, org chart, cycle prevention | 3–4 d |
| Leave | types/policies, balances, request → approve flow, holidays (BG/DE), notifications | 6–7 d |
| Attendance | manual check-in/out, office/remote, history, manager team view | 3–4 d |
| Calendar (basic) | month/week/day/agenda, events, leave + holiday layers, mobile agenda | 5–6 d |
| Notifications UI | bell, preferences, email templates (3 languages) | 2–3 d |
| Hardening | E2E happy paths, a11y pass, GDPR export/erase for employee data | 2–3 d |

## Phase 2 — People growth (~20 days)
Goals (personal/team/company, key results), 1:1 meetings (+ action items), Feedback, Skills Matrix.

## Phase 3 — Planning & insight (~20 days)
Performance reviews (cycles, self/manager review, ratings), Projects & assignments, Capacity, Analytics dashboards.

## Phase 4 — Advanced (~20+ days)
AI assistant (BYOK, tool-calling, read-only), calendar advanced (recurrence, sharing, invitations/RSVP, find-a-time), role editor UI, compensation (HR/Admin), polish.

## Free-tier stack (EU) — to verify at setup time
| Need | Choice (primary) | Fallback |
|---|---|---|
| Frontend hosting | Cloudflare Pages / Netlify (static) | Vercel |
| API | Render (Frankfurt) free web service — cold starts accepted | Fly.io (fra), Koyeb |
| Database | Neon (EU - Frankfurt) free | Supabase (EU) |
| Files | Cloudflare R2 free (EU jurisdiction) / Supabase Storage | — |
| Email | Resend (EU region) or Brevo free | — |
| Errors | Sentry (EU) free | — |
| CI | GitHub Actions | — |

## Next immediate steps
1. Approve this documentation; open PR `dev` → `main` for `docs/`.
2. Start Phase 0, step 1 (monorepo + CI) in `dev`.
