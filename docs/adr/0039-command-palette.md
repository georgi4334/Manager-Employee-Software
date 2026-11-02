# ADR 0039: Command palette (Ctrl+K)

Status: accepted (2026-11-02)

## Context

The menu has 20 entries in groups plus page sections. People who know where they want to go ("Eva's profile",
"WEB-12", "Leave approvals") still click through lists and filters. A keyboard-first search that jumps to pages,
people, projects and tasks, and starts the common actions, is the usual answer.

## Decision

- **Web only, no new endpoint or table.** The palette searches what the user can already reach:
  - **Pages**: the visible menu entries, and the sections (tabs) of a page from `PAGE_SECTIONS`
    ("Leave › Approvals"), with the same permission rules as the menu.
  - **Actions**: links to the place where a common action starts, each behind the permission that action needs
    (Request leave, Log time, Check in, New event, Give feedback, Add employee, New role, My profile, Notification
    settings). They navigate; they never change data from the palette.
  - **People, projects, tasks**: the existing list endpoints with `q` (`GET /employees?q&status=active`,
    `GET /projects?q&status=all`, `GET /tasks?q&status=all`), five results each, asked only with the permission of
    the page (`employee.view_directory`, `project.view`, `task.view`). The API's scoping decides what comes back;
    task keys (`WEB-12`) already match through the tasks search. A task opens `/tasks?project=…&q=KEY`.
- **Matching** (pure, tested, `features/palette/match.ts`): case and accents are ignored; a word start scores above
  a match inside a word; every typed word must match. Pages and actions are ranked locally; remote results keep the
  API's order. Remote searches wait 250 ms after typing and need 2 characters; results are cached by the query.
- **Opening**: Ctrl+K / ⌘K anywhere (also inside inputs, since it is not a typing key), and a "Search" button in
  the header (icon only on phones). Escape, a click outside or choosing an entry closes it; the focus returns.
- **Accessibility**: a modal dialog with an ARIA combobox (`aria-activedescendant`) over a listbox with labelled
  groups; arrows move, Enter opens, the number of results is announced politely. Every option says its kind in text.
- **Privacy**: nothing is stored (no history of searches, no recent items); queries go only to the existing,
  scoped endpoints, and the people result shows name, job title and department as the directory does.

## Consequences

- A new page appears in the palette by being in the menu (`app/nav.ts`) or in `PAGE_SECTIONS`; a new action is an
  entry in `features/palette/entries.ts` with a permission and en/de/bg texts in `palette.json`.
- The task page reads `q` from the address, so links to a search work.
- Opening the palette on a phone uses the same sheet; there is no keyboard shortcut there, only the button.
