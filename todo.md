# todo-cli → todo.sh — Roadmap & Status

A task manager with three surfaces over one store:

| Surface | Entry | Audience |
| ------- | ----- | -------- |
| **Web** (terminal.shop-style) | `npm run server` → `http://localhost:3000` | humans in a browser |
| **SSH TUI** | `ssh -p 2222 localhost` | humans in a real terminal |
| **CLI** | `node index.js list` | scripts & locals |

All three read/write `tasks.json` through `store.js`. Location is
overridable with `TASKS_FILE`.

## ✅ Done

### Foundation
- [x] `store.js` — id-based tasks (`{id, text, status, priority, createdAt, completedAt}`),
      legacy string migration, corruption-safe load, `TASKS_FILE` override.
- [x] CLI delegates to the shared store; StoreError → friendly message + exit 1.
- [x] Colored box-drawing tables, badges, progress bar (`utils/render.js`).

### Backend
- [x] Express REST API (`server/index.js`):
      `GET /api/health`, `GET /api/tasks` (filter `status`/`priority`),
      `POST /api/tasks`, `PATCH /api/tasks/:id` (text/status/priority),
      `DELETE /api/tasks/:id`, `GET /api/stats`.
- [x] Validation → 400, missing → 404, corrupted store → 500 w/ message.
- [x] Serves the built web client from `web/dist`.
- [x] `PORT=0` OS-assigned ports supported (logged after bind).

### SSH
- [x] `ssh2` server (`server/ssh-server.js`) with persistent RSA host key
      (`.ssh-host/`, override `SSH_HOST_KEY_DIR`) for stable fingerprints.
- [x] Line-based TUI (`server/ssh.js`): `list`, `add T --high|--med|--low`,
      `done N`, `undo N`, `rm N`, `stats`, `help`, `exit` — progress bar
      included, same command grammar as the web client.

### Web frontend
- [x] CRT terminal shell (`web/public/`): titlebar w/ traffic lights +
      live/offline health badge, blinking-prompt screen, boot banner.
- [x] Typed commands hitting the REST API, command hint chips,
      terminal.shop-style landing section below the fold.
- [x] Zero build step: static files copied to `web/dist` by
      `npm run build:web`; Express serves them.

### Verification
- [x] `npm test` — CLI smoke suite (10 checks).
- [x] `npm run test:api` — 13 API checks (boots server on ephemeral port).
- [x] `npm run test:ssh` — 10 SSH checks (real ssh2 client handshake +
      drives every TUI command end-to-end).

## 🔭 Next ideas

- [ ] Auth: SSH public keys + web sessions; per-user task stores.
- [ ] Server-Sent Events / WebSocket so web + SSH sessions update live.
- [ ] SQLite (better-sqlite3) behind the same store interface.
- [ ] Real keyboard TUI over SSH (arrow-key selection via raw mode).
- [ ] `--json` output flag; sort options; due dates.
- [ ] Deploy: Fly.io/VPS container running `node server/all.js`.

## Status

| Area | State |
| ---- | ----- |
| Shared store | ✅ id-based, migrated, corruption-safe |
| REST API | ✅ full CRUD + stats, tested |
| SSH TUI | ✅ live, tested end-to-end |
| Web terminal | ✅ styled, API-driven |
| CLI | ✅ unchanged UX on shared store |
| Auth | 🔭 next |
