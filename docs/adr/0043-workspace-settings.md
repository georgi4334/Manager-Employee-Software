# ADR 0043: Workspace settings

Status: accepted (2026-11-04)

## Context

A workspace's name, time zone and default language are set once, by `tenant:create`, and its default holiday
country lives in the leave settings. An administrator cannot rename the workspace or fix a wrong time zone without
a developer. `admin.tenant.settings` (Admin, scope `all`) already exists and guards the dashboard layout.

## Decision

- **No migration.** Editable fields and where they live:
  - **Name** (`tenant.name`, 1–100 characters, trimmed): shown in the profile drawer, the sign-in workspace choice,
    invitations and every email.
  - **Time zone** (`tenant.default_timezone`): an IANA zone the runtime knows (`isTimeZone` in contracts; `UTC` is
    allowed). It is the workspace "today" and the zone in which times are typed (`todayIn`/`zonedToUtc` in
    attendance, leave, calendar, 1:1s, time, reminders, retention, audit log days). A change applies **from the next
    request**; stored instants are not rewritten, so past records keep their moment and show in the new zone.
    People's own `app_user.timezone` is not touched.
  - **Default language** (`tenant.default_locale`, `en` / `de` / `bg`): used for emails when a person has no
    language of their own. The web app keeps following each person's choice.
  - **Default country** (`leave_settings.default_country`, the same value as in the leave settings and validated
    the same way, a two-letter code or empty): holidays and capacity for people without a country. The page offers
    the countries with holidays in the app (BG, DE, GB) and keeps any other stored code selectable.
  - The **slug** never changes (sign-in links and emails use it); it is shown read-only.
- **API** (`modules/workspace`): `GET /settings/workspace` (`@Authenticated()`, any member) returns name, slug, time
  zone, language, country and `canEdit` (holds `admin.tenant.settings` at scope `all`). `PUT /settings/workspace`
  (`@RequirePermission('admin.tenant.settings')`, and scope `all` checked in the service) takes any subset of name,
  timeZone, language, country (`updateWorkspaceSettingsRequestSchema`, strict, at least one field); errors are
  `VALIDATION_FAILED` with field codes. Nothing changes when the values are equal (no audit entry).
- **Tenancy**: the tenant row is read and written inside `TenantDb.tx` with `where: { id: requireTenantId() }`; the
  `tenant_self_update` RLS policy (ADR 0001) refuses any other row, so one workspace can never read or change
  another's settings. Leave settings are a tenant table with RLS as before.
- **Audit**: `workspace.updated` (area workspace, ADR 0041) with the changed **field names only**, never values.
- **Web**: `/settings/workspace` ("Workspace" in Administration, own `admin.tenant.settings` guard): one glass card
  with the form (react-hook-form + `zodResolver`, `forms.ts` with a parity test), Save with a success or error
  message. After saving, the signed-in user is reloaded so the new name shows at once.

## Consequences

- The web app still formats dates in each person's own or the browser's time zone; showing everything in the
  workspace zone is a separate decision.
- Logo upload waits for file storage.
