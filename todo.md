# todo.sh — Roadmap & Status

A task manager with three surfaces over one shared core:

| Surface | Entry | Audience |
| ------- | ------- | -------- |
| **CLI** | `todo …` (or `npm run todo`) | scripts & locals — no account, no server |
| **Web** (board + terminal dual view) | `npm run dev:backend` → `:3000` | humans in a browser |
| **SSH TUI** | `ssh -p 2222 localhost` | humans in a real terminal |

## ✅ Done (v1.2.0 — the dual-view rework)

### Web: board + terminal, one product
- [x] The web app opens on a GUI **board**: quick-add (text, priority, due
      date, tags), click-to-complete, inline edit form, delete.
- [x] Filter chips — all / open / done / overdue plus one per tag — and a
      live stats strip (total, open, done, overdue, progress bar).
- [x] Topbar **view toggle** (board ⇄ CRT terminal); the choice persists in
      localStorage and both views re-render from the same SSE feed.
- [x] Board actions go through the REST API; the terminal still speaks the
      shared grammar served verbatim to the browser.

### Schema: due dates + tags on every surface
- [x] Tasks carry `due` (ISO or null) and `tags` (lowercase, deduped, max 10);
      legacy files upgrade on load, invalid values surface as corruption.
- [x] Shared grammar: `add … --due DATE --tag a,b`, `due N DATE|clear`,
      `tag N a,b`, `untag N a`, `list [todo|done|--pri|+tag|overdue]`.
      Human dates resolve in the pure `parseDueDate` (today/tomorrow/weekdays/
      ISO), so CLI, SSH and web cannot drift.
- [x] Stores: due-aware sorting (open → priority → soonest due), `tag` and
      `overdue` filters, `stats.overdue`; Postgres schema gained `due` and
      `tags TEXT[]` columns (JSON→PG migration copies them too).
- [x] REST: `due`/`tags` on create+patch (validated, 400 on garbage),
      `?tag=&overdue=` filters; CLI/SSH banners and help updated.

### Bugs fixed during the rework
- [x] `createStoreFor` is awaited — Postgres mode previously handed out an
      unresolved promise (file mode masked it).
- [x] One cached store per user instead of a per-request store/pool; deleted
      accounts evict their cache entry.

## ✅ Done (v1.1.0)

### One grammar, many surfaces
- [x] CLI, SSH session and web terminal all execute through the shared
      `parseCommand`/`runCommand` (`@todo/shared/commands`) — the CLI's
      private parser and interactive helpers were deleted.
- [x] REST API exposes the same operations (CRUD + stats + health) and
      Bearer tokens for shell clients.
- [x] The shared grammar is served verbatim to the browser
      (`/vendor/shared-commands.js`) and re-verified by the web-path suite.

### Durable storage
- [x] Atomic JSON writes (tmp + rename) via `packages/shared/jsonfile.js`.
- [x] Per-file advisory locks around every read-modify-write — concurrent
      sessions (server + SSH + CLI) queue instead of clobbering. Tested
      with a 20-writer race and a 12-concurrent-create burst.
- [x] Optional Postgres adapter (`DATABASE_URL` at boot; `TODO_STORE=file`
      opts out) behind the same interface, with `npm run migrate:pg`.
- [x] Account deletion removes the user's task store too.

### Hardened auth
- [x] Password change (verifies current, revokes other sessions).
- [x] `GET /api/auth/sessions` + `DELETE /api/auth/sessions/:id` — users
      can see and kill their own sessions; the web client ships a panel
      for both.
- [x] Account self-service deletion (password-confirmed, wipes sessions
      and tasks).
- [x] Bearer tokens alongside cookies; rate limiting (auth 10/min/IP,
      writes 120/min/IP, `RATE_LIMIT=off` for tests); body size caps;
      `Secure` cookies behind TLS via `TRUST_PROXY=1`.
- [x] Minimum password length raised 6 → 8.

### Keep every surface in sync
- [x] Task mutations emit change events; `/api/events` streams them
      (SSE, per-user). Open web terminals re-render on foreign changes.
- [x] SSH sessions serialize command execution so output never interleaves.

### Make the server observable
- [x] JSON-line request logs (method, path, status, duration).
- [x] Versioned `/api/health`: version, store kind, uptime, booted-at.
- [x] Graceful SIGINT/SIGTERM shutdown of HTTP + SSH listeners.

### Shippable
- [x] GitHub Actions CI: all six suites on Node 20 and 22.
- [x] MIT license.
- [x] One container: Dockerfile running web + API + SSH with a data
      volume (Postgres mode via `DATABASE_URL`).
- [x] `bin: todo` + `npm run todo` alias — the README shell-function
      workaround is gone.
- [x] README rewritten CLI-first with a per-surface capability matrix and
      a TLS reverse-proxy guide (Caddy + nginx) for public deploys.

## 🔭 Next ideas (v1.3 candidates)

- Board: drag-to-reorder and a manual `move 3 1` ordering (list is currently
  sorted done-last → priority → due).
- Board: keyboard navigation (j/k, x to toggle) and multi-select.
- Recurring tasks (`add "trash" --every week`) with due-date awareness.
- Tag rename/merge across a whole account.
- Reassign / shared lists between accounts.
- TypeScript across `packages/shared` (types for tasks, stores, commands).
- SSH public-key auth (passwords only today).
- Arrow-key TUI over SSH via raw mode.
- SQLite adapter behind the same store interface.

## Hosting notes (why the free tiers don't work)

todo.sh is a long-running multi-protocol server: one Node process holds an
**HTTP listener** (REST + SSE + static web) *and* a raw **TCP listener on
port 2222** speaking the SSH protocol, and it persists to disk. That shape
is exactly what serverless/“free app” platforms can't run:

- **Vercel / Netlify (free tiers)** — functions are request-scoped, read-only
  filesystem, and can only accept HTTP. There is no way to listen on a second
  TCP port or hold the SSH handshake open; SSE also conflicts with short
  function timeouts. Verdict: not hostable without rewriting SSH out.
- **Fly.io / Render free tiers** — can run the process, but free instances
  sleep on idle and restart on a schedule. Sleeping kills open SSH and SSE
  sessions, and container-local disk (`tasks.json`, `.data/`) is wiped on
  every restart unless you add a paid persistent volume. The data-loss risk
  makes the free tier a no for anything real.
- **GitHub Pages / Surge / S3** — static only. The web terminal would render
  but there is no API, no accounts, no SSH.
- **Free Postgres tiers (Supabase/Neon)** — fine for the store itself
  (`DATABASE_URL`), but they solve storage only, not the long-running
  listeners.

**What actually works today:**

1. **Self-host on a small VPS** (the intended deployment): `docker run` the
   image, Caddy or nginx terminates TLS for the web/API surface (see
   README's TLS section), port 2222 stays firewalled or SSH-tunnelled.
   Cost: ~$4–6/mo. Nothing in the architecture fights you.
2. **Don't host at all** — the CLI and local `npm run dev:backend` cover
   single-user use with zero infrastructure. This is the default path, and
   the reason the CLI stayed account-less.

## Status

| Area | State |
| ---- | ----- |
| Shared core (store + grammar + accounts) | ✅ tested |
| Concurrency safety (atomic writes + file locks) | ✅ tested |
| Schema: due + tags (file + Postgres) | ✅ tested |
| Auth (password change, sessions, deletion) | ✅ tested |
| REST API | ✅ full CRUD + filters + stats, tested |
| SSH TUI | ✅ shared grammar, tested end-to-end |
| Web dual view (board + terminal) | ✅ board + live sync + settings |
| CLI | ✅ shared grammar, offline-first, --json |
| CI / license / container | ✅ |
| Public TLS deploy | 📖 documented (VPS + reverse proxy) |
| Manual ordering / recurring tasks | 🔭 v1.3 |
