# InTime — Roles & Permission Matrix

Roles are **data** (`role`, `permission`, `role_permission`). Permission codes are defined once in `packages/contracts` and seeded into the database.

**Scope legend** (how much data the permission applies to):
`own` = only my records · `reports` = my direct reports · `team` = my reporting subtree / team · `all` = whole tenant · `—` = no access.

Seeded system roles: **Admin**, **HR**, **Manager**, **Employee**. Future roles (e.g. _Outsourced_) are new rows with a subset of permissions — no code change.

## Matrix (Employee / Manager / HR / Admin)

| Module             | Permission code                                                     | Employee                  | Manager                                | HR                           | Admin  |
| ------------------ | ------------------------------------------------------------------- | ------------------------- | -------------------------------------- | ---------------------------- | ------ |
| **Employees**      | `employee.view_directory` (name, photo, position, team, work email) | all                       | all                                    | all                          | all    |
|                    | `employee.view_profile_full` (contact, birth date, contract)        | own                       | team                                   | all                          | all    |
|                    | `employee.create` / `employee.update` / `employee.deactivate`       | —                         | —                                      | all                          | all    |
|                    | `employee.update_self_basic` (phone, avatar, preferences)           | own                       | own                                    | own                          | own    |
|                    | `compensation.view` / `compensation.manage` _(later)_               | —                         | —                                      | all                          | all    |
| **Organization**   | `org.view` (chart, departments, teams)                              | all                       | all                                    | all                          | all    |
|                    | `org.manage` (departments, teams, reporting lines)                  | —                         | —                                      | all                          | all    |
| **Attendance**     | `attendance.record` (manual check-in/out)                           | own                       | own                                    | own                          | own    |
|                    | `attendance.view`                                                   | own                       | team                                   | all                          | all    |
|                    | `attendance.correct` (edit someone's record)                        | —                         | team                                   | all                          | all    |
|                    | `attendance.export`                                                 | —                         | team                                   | all                          | all    |
| **Leave**          | `leave.request`                                                     | own                       | own                                    | own                          | own    |
|                    | `leave.view`                                                        | own                       | team (calendar view: who is off)       | all                          | all    |
|                    | `leave.view_balance`                                                | own                       | team                                   | all                          | all    |
|                    | `leave.approve`                                                     | —                         | reports                                | all                          | all    |
|                    | `leave.manage_types_policies`                                       | —                         | —                                      | all                          | all    |
|                    | `leave.adjust_balance`                                              | —                         | —                                      | all                          | all    |
|                    | `holiday.manage`                                                    | —                         | —                                      | all                          | all    |
| **Goals**          | `goal.manage_personal`                                              | own                       | own + reports                          | all                          | all    |
|                    | `goal.manage_team`                                                  | —                         | team                                   | all                          | all    |
|                    | `goal.manage_company`                                               | —                         | —                                      | all                          | all    |
|                    | `goal.view`                                                         | own + team/company shared | team                                   | all                          | all    |
| **Performance**    | `review.write_self`                                                 | own                       | own                                    | own                          | own    |
|                    | `review.write_for_report`                                           | —                         | reports                                | all                          | all    |
|                    | `review.view`                                                       | own (after release)       | reports                                | all                          | all    |
|                    | `review.manage_cycles`                                              | —                         | —                                      | all                          | all    |
|                    | `review.calibrate`                                                  | —                         | —                                      | all                          | all    |
| **1:1 Meetings**   | `one_on_one.manage`                                                 | own (as participant)      | reports                                | —                            | —      |
|                    | `one_on_one.view_all`                                               | —                         | —                                      | **no** (privacy)             | **no** |
| **Feedback**       | `feedback.give`                                                     | all colleagues            | all colleagues                         | all                          | all    |
|                    | `feedback.view_received`                                            | own                       | own + reports (if shared with manager) | all (if shared with manager) | —      |
|                    | `feedback.moderate`                                                 | —                         | —                                      | all                          | all    |
| **Skills Matrix**  | `skill.view`                                                        | own + directory           | team                                   | all                          | all    |
|                    | `skill.update`                                                      | own                       | team                                   | all                          | all    |
|                    | `skill.manage_catalog`                                              | —                         | —                                      | all                          | all    |
| **Projects**       | `project.view`                                                      | assigned projects         | team projects                          | all                          | all    |
|                    | `project.manage`                                                    | —                         | own projects                           | all                          | all    |
|                    | `assignment.manage`                                                 | —                         | own projects                           | all                          | all    |
|                    | `client.view`                                                       | —                         | all                                    | all                          | all    |
|                    | `client.manage`                                                     | —                         | —                                      | all                          | all    |
|                    | `task.view`                                                         | assigned / own projects   | team projects                          | all                          | all    |
|                    | `task.manage`                                                       | own tasks (status only)   | own projects                           | all                          | all    |
| **Time Tracker**   | `time.log` (timer + manual entries)                                 | own                       | own                                    | own                          | own    |
|                    | `time.view`                                                         | own                       | team                                   | all                          | all    |
|                    | `timesheet.submit`                                                  | own                       | own                                    | own                          | own    |
|                    | `timesheet.approve`                                                 | —                         | reports                                | all                          | all    |
|                    | `timesheet.reopen`                                                  | —                         | —                                      | all                          | all    |
|                    | `time.report_project` (hours/budget vs actual)                      | —                         | own projects                           | all                          | all    |
|                    | `time.export` (approved hours CSV)                                  | —                         | own projects                           | all                          | all    |
| **Capacity**       | `capacity.view`                                                     | own                       | team                                   | all                          | all    |
| **Analytics**      | `analytics.view_team`                                               | —                         | team                                   | all                          | all    |
|                    | `analytics.view_company`                                            | —                         | —                                      | all                          | all    |
| **Calendar**       | `calendar.manage_own`                                               | own                       | own                                    | own                          | own    |
|                    | `calendar.manage_team_calendars`                                    | —                         | team                                   | all                          | all    |
|                    | `calendar.manage_company_calendar`                                  | —                         | —                                      | all                          | all    |
|                    | `calendar.view_free_busy`                                           | all                       | all                                    | all                          | all    |
| **Notifications**  | `notification.manage_own_prefs`                                     | own                       | own                                    | own                          | own    |
|                    | `notification.manage_tenant_defaults`                               | —                         | —                                      | —                            | all    |
| **AI**             | `ai.use`                                                            | own                       | own                                    | own                          | own    |
|                    | `ai.manage_own_key`                                                 | own                       | own                                    | own                          | own    |
|                    | `ai.manage_tenant_key` / `ai.toggle_tenant`                         | —                         | —                                      | —                            | all    |
| **Administration** | `admin.user.invite/disable`                                         | —                         | —                                      | all                          | all    |
|                    | `admin.role.assign`                                                 | —                         | —                                      | —                            | all    |
|                    | `admin.role.manage` (create/edit roles) _(later UI)_                | —                         | —                                      | —                            | all    |
|                    | `admin.tenant.settings`                                             | —                         | —                                      | —                            | all    |
|                    | `admin.audit_log.view`                                              | —                         | —                                      | read-only (HR events)        | all    |
| **GDPR**           | `gdpr.export_own`                                                   | own                       | own                                    | own                          | own    |
|                    | `gdpr.erase_employee` / `gdpr.manage_retention`                     | —                         | —                                      | all                          | all    |

## Hard rules (enforced in policies, covered by tests)

1. **Tenant isolation first** — no permission ever crosses tenants (RLS + guard).
2. **Employees see little**: their own data, the company directory, org chart, their own team calendar/free-busy.
3. **Managers** act only on their reporting subtree; "reports" for approvals means direct reports (configurable fallback approver = their manager/HR when absent).
4. **Reviews and salary**: HR + Admin only (managers: only reviews of their reports within an open cycle; **never** salary).
5. **Private 1:1 notes** are visible only to the two participants (even Admin/HR cannot read them); only `shared_notes` and action items are shared.
6. **Sick leave**: reason is never stored/displayed; managers see "absent", not the type, if the tenant enables `hide_leave_type_from_team`.
7. **No self-approval**: a user can never approve their own leave/review; approval escalates to the next manager/HR.
8. **Last-admin protection**: the last active Admin cannot be demoted or disabled.
9. **Every denied path has a test** (see test pattern below).

## Test pattern (applies to every permission)

For each row: one test per role that is **allowed** (positive) and one per role that is **denied** (negative), plus scope tests: _own vs other's record_, _report vs non-report_, _other tenant_. A generated test (`permissions.matrix.spec.ts`) iterates over the matrix definition in `packages/contracts` so the table and the tests cannot drift apart.

## Implementation notes

- Guard: `@RequirePermission('leave.approve')` → resolves the user's roles → permission + scope.
- Policy function per resource: `canApproveLeave(actor, request)` combines permission, scope and relationship checks (manager chain from recursive CTE), unit-testable without DB.
- Frontend: `<Can permission="leave.approve" resource={request}>` hides UI, but **the server is the only authority**.
- AI assistant tools execute through the same services as the user, so the matrix automatically limits what the assistant can answer.
