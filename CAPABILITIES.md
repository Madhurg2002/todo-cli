# todo.sh — Capabilities & Roadmap

What todo.sh does today, what it is wired to do next, and what it could grow
into — surface by surface, with honest effort estimates.

Read this together with [todo.md](todo.md) (status log) and
[RELEASE_NOTES.md](RELEASE_NOTES.md) (per-release changes).

## What todo.sh is

One task manager, three surfaces, one shared grammar (`@todo/shared/commands`):

| Surface | Entry | Best for |
| ------- | ----- | -------- |
| **CLI** | `todo …` (or `npm run todo`) | scripts & locals — no account, no server |
| **Web** | server on `:3000` | GUI board + CRT terminal, toggleable |
| **SSH TUI** | `ssh -p 2222 <host>` | real terminal over any network |

Every surface speaks the same commands and edits the same data. A change on
one surface appears on the others (SSE live feed on web, re-list on SSH).

---

## Shipped capabilities (v1.2.0)

### Command grammar (shared by every surface)

| Command | Example | Notes |
| ------- | ------- | ---- |
| `add` | `add "ship v1.2" --high --due friday --tag dev,ops` | due + tags inline |
| `list` | `list`, `list todo`, `list --high`, `list +dev`, `list overdue` | tag/overdue/status/priority filters |
| `done` / `undo` / `rm` | `done 2` | numbers are positions in the sorted view |
| `edit` | `edit 2 "new text"` | retype the text |
| `due` | `due 2 tomorrow`, `due 2 clear` | today/tomorrow/weekdays/ISO dates |
| `tag` / `untag` | `tag 2 home`, `untag 2 home` | lowercase, max 10 |
| `stats` | `stats` | totals, by-priority, **overdue count** |
| `whoami` | `whoami` | signed-in account (or local session) |
| `help` / `clear` / `exit` | | terminal surfaces |

### Web app (board + terminal)

- **Board**: quick-add with priority/due/tags, click-to-complete, inline edit
  (text + priority + due + tags in one form), delete, filter chips
  (all/open/done/overdue + one per tag), live stats strip with progress bar.
- **Terminal**: full CRT view speaking the shared grammar, history (↑/↓),
  Ctrl+L clear, Tab completion, clickable command hints.
- **Settings**: change password, list/kill sessions, delete account.
- **Live sync**: every mutation streams over SSE (`/api/events`); board and
  terminal re-render when another surface changes the list.

### CLI & SSH

- CLI is **account-less and offline-first** — `npm install` and `todo list`
  works against a local `tasks.json`; `--json` output for scripts/status bars.
- SSH TUI: same grammar, same accounts as the web; serialized command queue
  so output never interleaves.
- Both gained due/tag flags and filters in v1.2.0.

### Storage & API

- **File store** (default): atomic writes (tmp+rename), per-file advisory
  locks, legacy file upgrade on load.
- **Postgres store**: auto-selected by `DATABASE_URL`; covers tasks **and**
  accounts/sessions; schema auto-created on first boot;
  `npm run migrate:pg` copies the JSON users, sessions and tasks over.
- **REST API**: auth (register/login/logout, sessions, password, account
  deletion), tasks CRUD + `?status/priority/tag/overdue` filters, stats,
  SSE change feed, Bearer tokens for scripts.
- **Hardening**: scrypt password hashing, rate limiting, body caps, secure
  cookies behind TLS, JSON-line request logs, graceful shutdown.

### Ops

- Single Dockerfile (web + API + SSH, data volume), GitHub Actions CI
  (all six suites on Node 20/22, plus a Postgres-backed run), MIT license.
- Two Render blueprints: `render.yaml` (disk-backed, ~$7/mo) and
  `render-free.yaml` (Postgres-backed, **$0**).

---

## Planned next (near-term, unstarted)

### P1 — Board UX

1. **Keyboard navigation** — `j/k` move, `x` toggle, `e` edit, `d` delete,
   `a` focus quick-add. The board is mouse-first today.
2. **Drag-to-reorder + manual ordering** — needs a `order` field and a
   `move N M` command; `sortForList` respects manual order first.
3. **Multi-select & bulk actions** — complete/delete/tag several tasks.
4. **Undo toast** — the API has no undo; a client-side timed undo (5s) is cheap.

### P2 — Grammar & data

1. **Recurring tasks** — `add "trash" --every week`; needs recurrence rules
   on the schema and auto-respawn on completion.
2. **Due-time-of-day** — due currently defaults to 17:00 local; accept
   `--due "fri 9am"` and keep the time across edits.
3. **Subtasks / dependencies** — `blocks`/`blocked-by` links with an
   `add "x" after 3` shortcut.
4. **Tag rename/merge** — `tag rename old new` across the whole account.

### P3 — Surfaces

1. **Editor/IDE surfaces** — VS Code extension and/or Neovim plugin wrapping
   the CLI's `--json` mode.
2. **HTTP one-liner mode** — `curl $HOST/api/tasks …` snippets in README;
   scripts/status-bar recipes (waybar/polybar/SketchyBar) using Bearer tokens.
3. **Export/import** — `todo export --json > backup.json`,
   `todo import backup.json` (also the base for account migration).

---

## Integration candidates (external services)

Ideas that map to real services. Each names the env var it would need and a
free-tier option. Nothing here is wired up yet.

### Email reminders — via **Resend**

Send "due today / overdue" digests or per-task reminders.

- Env var: `RESEND_API_KEY` · free tier available · docs: resend.com/docs
- Fit: developer-first API, simple REST call from a Node action; the app
  already has an email-free notification shape (SSE) — this extends it.
- Sketch: `apps/backend/server/notify.js` with a daily interval scanning
  `due` fields; per-user opt-in (`settings.email` on the account).
- **Alternative:** **Knock** if you want multi-channel (email + push +
  in-app) notification workflows with preferences/unsubscribes instead of
  raw email API calls.

### Managed Postgres — via **Tiger Cloud** (or Neon)

Already shipped. `DATABASE_URL` moves tasks, accounts and sessions into the
database, which is what makes the $0 Render free tier work: a disk-less,
sleeping container loses nothing. `render-free.yaml` wires it up.

- Env var: `DATABASE_URL` · free tier (no credit card) · docs: tigerdata.com/docs
- Fit: zero code changes — set the env var, optionally run `npm run migrate:pg`.
- **Alternative:** **Neon** — serverless Postgres with branching; equally
  drop-in via `DATABASE_URL`, good if you want scale-to-zero.

### AI task parsing & daily summary

Natural-language task entry (`"remind me to call the bank tomorrow"` →
task with due date) and a "plan my day" summary in the board.

- Env var: `SAMBANOVA_API_KEY` · docs: docs.sambanova.ai
- Fit: an OpenAI-compatible chat endpoint callable with plain `fetch` from
  Node 18 — no SDK required, so no new dependencies.
- Keep it optional: when the key is absent, the endpoint answers 501 and the
  UI hides the affordance — the product never depends on it.
- **Alternative:** any OpenAI-compatible endpoint (the sketch is identical).

### Other candidates worth exploring

| Idea | Service shape | Why |
| ---- | ------------- | --- |
| Push/web reminders | in-app notification service (e.g. Knock) | browser push without native apps |
| Public sharing links | signed URL + read-only API scope | share a filtered list without accounts |
| Calendars | iCal export endpoint (`/api/tasks.ics`) | due dates → calendar apps, zero deps |
| Metrics | hosted metrics/uptime monitor | visibility for public deployments |
| Payments (SaaS mode) | billing platform | only if todo.sh becomes a paid product |

---

## If the goal is a hosted product

The README's hosting section covers the self-host path (VPS + TLS proxy).
For a small hosted SaaS, a pragmatic stack:

1. **App**: small VPS or container host (the SSH listener needs a real
   process + TCP port; serverless won't run it).
2. **Data**: managed Postgres (see Tiger Cloud/Neon above) instead of disk.
3. **Email**: Resend or similar for reminders and transactional email.
4. **TLS**: Caddy in front of the HTTP surface; keep `SSH_PORT` private.

Free-tier reality check: serverless platforms can't host the SSH listener,
and sleeping free containers kill open SSH/SSE sessions — the same trade-offs
documented in [todo.md](todo.md)'s hosting notes.

---

## Effort estimates (single dev)

| Item | Effort | Risk |
| ---- | ------ | ---- |
| Board keyboard nav | S | low |
| Undo toast | S | low |
| Export/import commands | S | low |
| Due time-of-day | S/M | low |
| `move`/manual ordering | M | medium (schema + all surfaces) |
| Recurring tasks | M | medium (respawn logic, edge cases) |
| iCal endpoint | S/M | low |
| Email reminders (Resend) | M | low (needs opt-in + scheduler) |
| AI parsing (fetch-based) | M | medium (prompt quality, cost) |
| Subtasks/dependencies | L | high (UI across surfaces) |
| Multi-user sharing | L | high (permissions, isolation) |

## Non-goals

- Not a team/project-management product (no workspaces, no roles).
- No third-party account login (username/password + sessions only).
- No mobile app; the responsive web app is the mobile experience.
