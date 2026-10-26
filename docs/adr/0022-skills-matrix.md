# ADR 0022 — Skills matrix: a skill catalog and who has which level

Status: accepted · Phase 3 step 4 · Builds on [ADR 0003](0003-roles-and-permissions.md), [0007](0007-organization.md), [0011](0011-gdpr-export-erasure.md), [0013](0013-clients-and-projects.md)

## Context

HR, managers and colleagues should be able to answer **"who knows what, and how well?"** and employees should be able to say
what they can do. The permission catalog already has `skill.view` (own / team / all), `skill.update` (own / team / all)
and `skill.manage_catalog` (HR, Admin). Out of scope: project skill requirements and staffing suggestions (they join this
with Capacity later), certificates and expiry dates, endorsements by colleagues, skill gap reports, AI suggestions.

## Decisions

### 1. Data (three tables, RLS, composite `(tenant_id, id)` foreign keys)

- `skill_category`: `name` (≤ 60, unique per workspace), `position`.
- `skill`: `category_id`, `name` (≤ 60, unique per workspace, compared without regard to case), `description` (≤ 300),
  `archived_at`. Names belong to the workspace and are **not translated**.
- `employee_skill`: `employee_id`, `skill_id` (unique pair), `level` 1–5, `assessed_by_employee_id`, `assessed_at`.

Levels have fixed meanings, translated in the web app: 1 Beginner, 2 Basic, 3 Proficient, 4 Advanced, 5 Expert.
`assessed_by` shows whether a level is a **self-assessment** (the employee) or was set by a manager or HR. The last writer
wins; there is no history.

### 2. Who may do what

| Action                          | Permission                                     | Scope                                                                           |
| ------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------- |
| read the catalog                | `skill.view`                                   | anyone who holds it                                                             |
| see a person's ratings          | `skill.view` through `authz` on the employee   | own / team (self, reports, their reports) / all; a person out of scope is `404` |
| set or remove a rating          | `skill.update` through `authz` on the employee | the same scopes; **a manager can rate their team**, an employee only themself   |
| create, rename, archive, delete | `skill.manage_catalog`                         | HR and Admin                                                                    |

An archived skill keeps its ratings and shows in the matrix but cannot be newly rated (`skill_archived`). A skill can be
deleted only while nobody has rated it (`CONFLICT`, `field: in_use`), a category only while it holds no skills.

### 3. Matrix

`GET /skills/people` lists the active people the caller may see with their ratings, filterable by category, **skill and
minimum level** ("who knows React at level 3 or more"), and name; paged. The web app shows them as cards (no wide table
on a phone) with the rated skills as short lines, grouped by category.

### 4. Audit, notifications, privacy

- Catalog changes are audited (ids and field names, never names). Ratings are personal data and are **not audited**.
- No notifications.
- Export lists the person's ratings (skill name, category, level, who set it, when). Erasure deletes the person's ratings;
  the catalog is not personal data.
- A deactivated person drops out of the matrix; ratings stay until erasure.

### 5. Web

`/skills` with three tabs: **My skills** (everyone: a level per skill, grouped by category), **People** (the matrix as
cards; for those who may rate others, an edit action per person) and **Catalog** (HR/Admin: categories and skills).
Nav entry for `skill.view`.

## Consequences

- Without history, "who rated me lower" cannot be answered; that avoids a performance-review shadow system (Phase 4 owns
  reviews).
- A manager sees skill levels of their whole team (not only direct reports), as the permission catalog says.
