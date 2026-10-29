# ADR 0014 — Tasks (lean): list and board per project

Status: accepted · Phase 2 step 2 · Builds on [ADR 0013](0013-clients-and-projects.md), [0003](0003-roles-and-permissions.md), [0011](0011-gdpr-export-erasure.md)

## Context

Projects have people and milestones; the work in between needs a place: **what has to be done, by whom, until when,
how big, and where it stands.** This is deliberately lean (roadmap: "no sprints, no sub-tasks"). The time tracker of the
next step charges hours to a task, so tasks need stable references.

## Decisions

### 1. Data model (`task`, tenant-scoped, RLS, composite `(tenant_id, id)` foreign keys)

`project_id` (required), `number` (1, 2, 3 … per project, assigned in the same transaction that creates the task;
the reference people use is `CODE-number`, e.g. `WEB-12`), `milestone_id` (optional, **must belong to the same
project**: enforced by a composite foreign key), `title` (≤ 120), `description` (≤ 2000), `type` (`functional` /
`non_functional`), `status` (`todo` / `in_progress` / `review` / `done`), `priority` (`low` / `normal` / `high`),
`assignee_employee_id` (optional), `estimate_hours` (optional, half-hour steps, ≤ 1000), `due_date` (optional),
`done_on` (set when the task becomes `done`, cleared when it is reopened).
`project.task_seq` (new column) counts the numbers; the number is unique per project.

Database checks repeat the value rules (types, statuses, lengths, estimate ≥ 0, `done_on` present exactly when `done`).

### 2. Who sees and changes what (permissions already in the catalog)

| Action                       | Permission                           | Rule                                                                                                                                                                       |
| ---------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List / open tasks            | `task.view`                          | the tasks of the projects the caller sees through that scope (project lead or staffed person inside the scope; `own` = my projects) plus tasks assigned to people in scope |
| Create, edit, delete, assign | `task.manage` **and** project rights | scope `all`, or the caller leads the project (`project.manage` covers its lead) — so project leads, HR and Admin; staffed people do not create tasks                       |
| Move your own task along     | `task.manage`                        | the assignee changes **only the status** of a task assigned to them (employees: nothing else)                                                                              |

A task on a project the caller cannot see is `404`. `canEdit` (everything) and `canMove` (status only) are computed
per caller; the UI follows them. **The assignee must be an active employee staffed on the project (any assignment) or
its lead**, so tasks never wander outside the project team (`assignee_not_on_project`).

### 3. Notifications, audit, offboarding, GDPR

- Giving a task to somebody else sends `task.assigned` (project id and the task reference such as `WEB-12`; **never the
  title**, which is free text).
- Task changes are audited with ids and field names only.
- Deactivating an employee un-assigns their open tasks (same transaction as the other offboarding steps).
- Data export lists the tasks assigned to a person (reference, title, status, estimate, due date). Erasure keeps tasks:
  they describe work, not the person, and the assignee becomes the anonymised record.

### 4. Web

"Tasks" in the navigation: **List** and **Board** views of the same data (the board groups by status; moving a card is
a status select, no drag and drop, so it works on phones and with a keyboard), filters for project, "assigned to me",
status and type, search by title or reference, a form to create and edit. The project page links to its tasks and shows
the open count. All strings en/de/bg, 375 px first.

## Consequences

- One new table and one new column on `project` (expand-only).
- Time tracking (next step) references `task.id`; leave-conflict warnings will also read `task.due_date`.
- Sub-tasks, comments, attachments, labels and drag and drop are out of scope.

## Update: board and list design

The board is four soft columns (colour dot, status and count in the heading) holding cards: key tag and edit/delete icons on top,
the title, type/priority/overdue tags, a four-step stage bar (decoration, the column and select say the stage in words), then
assignee avatar, due/done date and hours, and the status select for people who may move the task. The list is one row per task:
a stage icon tile, title with tags and milestone, assignee and dates, the status select and icon actions; rows stack on phones.
Both use the same `TaskCard` (`variant`), the shared `Chip`/initials in `shared/ui/tiles.tsx` and only design tokens. Behaviour,
permissions and API are unchanged.
