# todo.sh — Roadmap & Status

A task manager with three surfaces over one shared core:

| Surface | Entry | Audience |
| ------- | ----- | -------- |
| **Web** (terminal.shop-style) | `npm run dev:backend` → `:3000` | humans in a browser |
| **SSH TUI** | `ssh -p 2222 localhost` | humans in a real terminal |
| **CLI** | `npm run dev:terminal` | scripts & locals |

## ✅ Done

### Structure (npm workspaces)
- [x] `apps/backend` (@todo/backend) — REST API, SSH TUI, combined entrypoint,
      integration tests.
- [x] `apps/terminal` (@todo/terminal) — interactive CLI, smoke tests,
      Windows launcher.
- [x] `apps/frontend` (@todo/frontend) — web terminal client (public/ source,
      dist/ served by the backend).
- [x] `packages/shared` (@todo/shared) — the shared core:
  - `store.js` — id-based tasks, legacy migration, corruption-safe load,
    `TASKS_FILE` override.
  - `render.js` — chalk box-drawing table renderer.
  - `commands.js` — command grammar: `parseCommand`, `runCommand`,
    `progressBar`, help text. I/O-agnostic: callers supply an io sink.

### One grammar, many surfaces
- [x] SSH session executes through the shared `runCommand` (chalk io sink).
- [x] Web terminal executes through the same `runCommand` (DOM io sink via
      a browser bundle served at `/vendor/shared-commands.js`).
- [x] REST API exposes the same operations over HTTP (CRUD + stats + health).

### Backend
- [x] Express REST API: `GET /api/health`, `GET /api/tasks`
      (filter `status`/`priority`), `POST /api/tasks`,
      `PATCH /api/tasks/:id`, `DELETE /api/tasks/:id`, `GET /api/stats`.
- [x] Validation → 400, missing → 404, corrupted store → 500 w/ message.
- [x] ssh2 server with persistent RSA host key (`.ssh-host/`).

### Frontend
- [x] CRT terminal shell: titlebar w/ traffic lights + health badge,
      boot banner, typed commands, clickable hint chips, landing section.

### Verification
- [x] `npm test` — CLI smoke suite.
- [x] `npm run test:api` — 13 API checks.
- [x] `npm run test:ssh` — 10 SSH checks (real ssh2 client, end-to-end).

## 🔭 Next ideas

- [ ] Auth: SSH public keys + web sessions; per-user task stores.
- [ ] Live sync (SSE/WebSocket) so web + SSH sessions update in real time.
- [ ] TypeScript across packages; shared type definitions for tasks.
- [ ] SQLite (better-sqlite3) behind the same store interface.
- [ ] Arrow-key TUI over SSH via raw mode; `edit`/`remove` in web + ssh.
- [ ] `--json` output; sort options; due dates.
- [ ] Deploy: container running `node apps/backend/server/all.js`.

## Status

| Area | State |
| ---- | ----- |
| Workspace structure | ✅ apps/backend · apps/terminal · apps/frontend · packages/shared |
| Shared core | ✅ store + renderer + command grammar |
| REST API | ✅ full CRUD + stats, tested |
| SSH TUI | ✅ shared grammar, tested end-to-end |
| Web terminal | ✅ shared grammar, API-driven |
| CLI | ✅ on shared store |
| Auth | 🔭 next |
