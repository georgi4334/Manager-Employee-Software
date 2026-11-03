# ADR 0040: Onboarding and offboarding checklists

Status: accepted (2026-11-03)

## Context

When someone joins or leaves, the same things have to happen every time: a contract signed, a laptop handed out or
returned, accounts opened or closed, an introduction meeting, a farewell. Today this lives in HR's head or a
spreadsheet. The app already knows the hire and termination dates and the reporting line, so it can start the list,
date every step and tell the right people.

## Decision

### Data (all RLS, `tenant_id` default, composite foreign keys)

- `checklist_template`: `kind` `onboarding` | `offboarding`, `name` (1–80), `is_default` (at most one default per kind,
  partial unique index), timestamps. At most 30 templates per workspace (`CONFLICT`, `field: limit`).
- `checklist_template_item`: `title` (1–120), `description` (≤ 500, optional), `responsible` `employee` | `manager` |
  `hr`, `offset_days` (−60 … 180, days from the start or leaving date), `position`. At most 50 per template.
- `checklist`: one run for one person: `employee_id`, `kind`, `name` (copied), `anchor_date` (hire or termination
  date), `status` `open` | `done` | `cancelled`, `completed_at`, `cancelled_at`. **One open checklist per person and
  kind** (partial unique index; `CONFLICT`, `field: open`).
- `checklist_item`: copied from the template when a checklist starts (later template changes never touch running
  checklists): `title`, `description`, `responsible`, `assignee_employee_id` (nullable), `due_date`, `done_at`,
  `done_by_employee_id`, `position`. At most 50 per checklist.

The due date is `anchor + offset_days` (`checklistDueDate`, pure, contracts). Progress and the state of an item
(`done`, `overdue`, `due_soon` = within 3 days, `open`) are computed, never stored (`checklistProgress`,
`checklistItemState`). A checklist turns `done` when its last item is ticked and back to `open` when one is unticked.
A cancelled checklist is locked (`CONFLICT`, `field: status`).

### Who does an item

When a checklist starts, `responsible` is resolved once: `employee` → the person themself, `manager` → their manager
at that moment (none → nobody), `hr` → nobody. An item without an assignee belongs to **the HR group**: everybody who
holds `checklist.manage` at scope `all`. People who manage the checklist can change the assignee to any active
employee (`unknown_employee` otherwise) and edit, add or remove items.

### Permissions (module `checklists`)

| Code                         | Employee | Manager | HR  | Admin | Meaning                                  |
| ---------------------------- | -------- | ------- | --- | ----- | ---------------------------------------- |
| `checklist.view`             | own      | reports | all | all   | see checklists about people in scope     |
| `checklist.manage`           | –        | reports | all | all   | start, cancel, edit items, tick any item |
| `checklist.manage_templates` | –        | –       | all | all   | create, change, delete templates         |

Scopes go through `authz` on the **person the checklist is about** (`ownerEmployeeId`); lists use
`allowedEmployees`. **An assignee always sees the checklist an item of theirs belongs to and may tick their own
items**, whatever their permissions; everybody else gets `404`. Templates are readable by holders of
`checklist.manage` or `checklist.manage_templates` (managers pick one to start a checklist).

### Starting and stopping

- **Automatic**: creating an employee starts the default onboarding template (anchored at the hire date, else
  today); deactivating one starts the default offboarding template (anchored at the termination date), in the same
  transaction. No default template = nothing starts.
- **By hand**: `POST /checklists` (`checklist.manage` over the person) with a template and an optional anchor date.
- **Deactivation** also cancels the leaver's open onboarding checklist, and un-assigns the leaver's open items on
  other people's checklists (they fall back to the HR group).

### Notifications and audit

- `checklist.assigned` goes to each assignee with an account (never the actor) when a checklist starts and when an
  item is (re)assigned: checklist id and the number of items only — never titles, names or the kind.
- Audit (ids and field names only): `checklist_template.created|updated|deleted`, `checklist.started|cancelled`
  (checklist id, employee id, kind). Ticking an item is not audited (it is visible on the item: who and when).

### Privacy

- Export: the checklists about the person (items with title, due date, done) and the items assigned to them on
  other checklists (title, due date, done; not whose checklist).
- Erasure: deletes the checklists about the person and clears them as assignee or ticker on other checklists.

### Web

- `/checklists` (guard `checklist.view`) with sections (ADR 0037): **My to-dos** (open items assigned to me, and
  HR-group items for HR), **People** (checklists in scope, filter by kind and status; start one), **Templates**
  (`checklist.manage_templates`). `/checklists/:id`: header with the person, kind, date and a progress capsule, the
  items as a dated track grouped by responsible with a checkbox, assignee and due date; manage actions inline.
  `/checklists/templates/:id` and `/checklists/templates/new`: name, kind, default, items (title, responsible,
  offset).
- "Waiting for me" (ADR 0038) gets a sixth kind: my open checklist items, with a "Mark done" button.
- Menu entry "Checklists" in the People group.

## Consequences

- No reminders before a due date yet (the hourly sweep could add them later, like ADR 0029).
- No file attachments (they wait for file storage).
- The employee profile does not show the checklist yet; the People list links to it.
