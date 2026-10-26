# ADR 0027 — Automatic retention (Bulgaria)

Status: accepted · Phase 5 · Builds on [ADR 0011](0011-gdpr-export-erasure.md), [0025](0025-ai-assistant.md)

## Context

GDPR asks for storage limitation: personal data is kept only as long as it is needed. ADR 0011 gave HR a manual, irreversible
erasure of a former employee and left **automatic retention periods** open because they need a per-country decision. The
product starts with **Bulgaria only**; Germany and others follow later, each with its own review. This ADR adds an automatic
erasure of former employees after a configurable period, with a Bulgarian preset.

**These numbers are product defaults, not legal advice.** The employer is the data controller and must confirm the periods with
its legal adviser or data protection officer (statutory periods for payroll, accounting and social-security records are kept
outside InTime, which holds no payroll). The page says so.

## Decisions

### 1. What is retained automatically

- **Former employees**: a person who is `inactive` and whose termination date is more than N months ago is **anonymised** by the
  existing erasure (ADR 0011): identifying and free-text data goes; hire/termination dates, attendance times and leave days stay,
  detached from the person.
- Preset for Bulgaria: **60 months** after the termination date. Reason: employment-related claims have limitation periods of
  a few years, so records about the person are kept for a margin beyond them, then the person is removed. Allowed range
  12–600 months.
- Not covered here (already handled elsewhere or out of scope): notifications and the outbox (fixed periods, ADR 0004), AI
  conversations (workspace retention, ADR 0025), the audit log (ids only, append-only), accounts that were invited and never
  accepted.
- An inactive person **without a termination date** is never erased automatically (there is nothing to count from); HR sees
  them in the list as "no termination date".

### 2. Control, off by default

- `retention_policy` (RLS, one row per workspace): `country` (`BG` only), `enabled` (default **off**), `former_employee_months`
  (default from the preset), `last_run_at`, `last_run_erased`. No row means the preset values, disabled.
- Needs `gdpr.manage_retention` (HR, Admin; the permission was reserved for this). Changes are audited (values of the policy,
  never names).
- A workspace with another country than `BG` cannot enable it: the API accepts only `BG`; other countries need a reviewed preset
  (`RETENTION_PRESETS` in contracts).

### 3. Legal hold and preview

- `employee.retention_hold` (boolean): HR can keep a person out of the automatic erasure (for example during a dispute).
  Setting and releasing a hold is audited with ids only. A hold never blocks the manual erasure by HR (a person's right to
  erasure is separate).
- The retention page shows, for people with `gdpr.manage_retention`, **who would be erased now or in the next 90 days** (name,
  termination date, due date, hold). HR already sees these names; nothing new is exposed. The list is capped at 100.

### 4. The job

- `RetentionRunner` runs from the same hourly sweep and external hook as the reminders (once a day is enough: it checks a day
  boundary). For every workspace with an enabled policy it erases at most **25 due people per run** (the rest wait for the next
  run), each through the existing `ErasureService` (system connection, every statement scoped by tenant), then records
  `last_run_at` and the count.
- The automatic erasure is audited as `privacy.erased` with no actor and `{ reason: 'retention' }`. It is idempotent: an already
  erased person is skipped; a person reactivated since is not eligible any more (checked in the erasure's conditional update).
- A failure in one workspace is logged (ids only) and does not stop the others.

### 5. Web

- `/retention` (own `gdpr.manage_retention` guard, nav entry "Data retention"): the status (off/on, country Bulgaria, period,
  last run), a switch, the period, the plain-words explanation of what is erased and what stays, the list of upcoming erasures with
  a hold button per person. Turning it on asks for confirmation (it is irreversible per person).

### 6. Out of scope

Other countries, per-data-type periods, retention of the audit log, candidate data (no recruiting module), notifying people before
their erasure, exporting data automatically before erasure.
