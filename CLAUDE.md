# InTime — project instructions

Employee management SaaS (multi-tenant, GDPR, EU hosting, free tiers). Solo developer + Claude. Repo: `georgi4334/Manager-Employee-Software`.
Source of truth: `docs/data-model.md`, `docs/permission-matrix.md`, `docs/roadmap.md`. Read the relevant section before building a feature; update the docs when a decision changes.

## Stack

- Monorepo: pnpm + Turborepo. Packages: `@intime/web` (apps/web), `@intime/api` (apps/api), `@intime/contracts` (packages/contracts: Zod schemas, permission codes, shared types).
- Web: React 19, TypeScript, Vite, React Router v7 (library mode), Zustand (UI state) + TanStack Query (server state), Tailwind with CSS-variable tokens, react-i18next (en, de, bg).
- API: NestJS, PostgreSQL + Prisma, Row Level Security per tenant, pg-boss jobs, Passport (email/password argon2id + Google).

## Workflow

- Branches: `main` (stable, PR only) and `dev` (daily work). Never push to `main` directly. Open a PR `dev` -> `main` only when asked.
- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). Small, focused commits.
- Do not start code for a module before its design is in `docs/`. Don't add features outside the current roadmap phase.

## Definition of Done (every feature)

1. Unit tests with positive AND negative cases (invalid input, forbidden role, wrong tenant, not found, duplicate, boundary).
2. Permission checks covered by the matrix test; the server is the only authority, UI hiding is cosmetic.
3. Mobile-first responsive (check 375px). No hard-coded colors: use design tokens only (`bg-primary`, etc.).
4. Every user-facing string translated in en, de, bg. Backend returns error codes, never display text.
5. Personal data minimal; GDPR export/erase considered; sick-leave reason is never stored.
6. `pnpm lint && pnpm typecheck && pnpm test` pass before committing.

## Code conventions

- TypeScript strict, no `any` without a comment. Validate all input with Zod (schemas live in `@intime/contracts`).
- Every table has `tenant_id`; every query is tenant-scoped. Never trust ids from the client without a tenant + permission check.
- Never log secrets, tokens, AI keys or personal data. AI keys are encrypted at rest and never returned to the browser.
- Match surrounding code style; keep comments rare and only for non-obvious "why".

## Token/usage discipline

- Be specific: point to files/doc sections instead of broad searches. Start a fresh session per feature.
- Design for risky areas (tenancy, auth, permissions, leave rules, time tracker rules, AI keys) deserves the strongest model; routine CRUD/UI/tests use the mid-tier; translations/boilerplate the cheapest.
