# todo.sh

A task manager you can ssh into — plus a terminal-style web client and a
classic CLI, all over one shared store.

```
Web (browser)   →  http://localhost:3000      CRT terminal UI (sign in)
SSH TUI         →  ssh -p 2222 localhost       live line-based session
CLI             →  npm run dev:terminal        scripts & locals (no account)
```

One account works everywhere: register in the browser once, then
`ssh -p 2222 you@localhost` and you're in the same task list.

## Structure (npm workspaces)

```
apps/
  backend/     @todo/backend    REST API, SSH TUI, combined entrypoint
    server/    express app, ssh2 server, shared-grammar bundle
    test/      api + ssh integration suites
  terminal/    @todo/terminal   interactive CLI
    utils/     colored tables, prompts
    test/      CLI smoke suite
  frontend/    @todo/frontend   web terminal client
    public/    index.html, style.css, app.js (source)
    dist/      build output served by the backend
packages/
  shared/      @todo/shared     the shared core
    store.js     task store + createFileStore adapter
    render.js    box-drawing table renderer (chalk)
    commands.js  pure command grammar: parseCommand, runCommand
    accounts.js  users, scrypt hashing, sessions, per-user paths
```

One grammar, many surfaces: the SSH stream and the browser terminal both
execute through `runCommand` from `@todo/shared/commands` — they only
differ in the io sink (chalk stream vs DOM spans) and the store adapter
(per-user JSON file vs REST calls).

## Quick start (fresh clone → running in ~1 minute)

Requires Node 18+. No services, no accounts, no API keys — everything
is local.

```bash
git clone <this-repo>
cd todo-cli
npm install           # installs deps AND builds the frontend automatically
npm run dev:backend   # API + web on :3000, SSH on :2222
```

Then open http://localhost:3000 and create an account, or connect from
a real terminal with the same credentials:

```bash
ssh -p 2222 you@localhost
# try: add "ship it" --high   ·   list   ·   done 1   ·   stats
```

The first run creates `tasks.json` (your data) and `.ssh-host/` (a
generated SSH host key) — both are gitignored, never committed.
Ports are configurable with `PORT`, `SSH_PORT`, `HOST`, `TASKS_FILE`
(see Configuration below), e.g. if 3000 is taken:

```bash
PORT=4000 npm run dev:backend
```

## Surfaces

### 1. Web terminal (`/`)
A terminal.shop-style CRT client. Type commands (`add "task" --high`,
`list`, `done 1`, `stats`, `help`) into the prompt; everything talks to
the REST API below.

### 2. SSH TUI
`ssh -p 2222 you@<host>` lands you in a live session backed by your own
store: banner, task table with progress bar, and the same command set.
A persistent host key is generated under `.ssh-host/` on first run.
Authentication uses the same username/password as the web client.

### 3. CLI (`apps/terminal`)

```bash
npm run dev:terminal                   # or: node apps/terminal/index.js

node apps/terminal/index.js add "buy milk"            # default (med) priority
node apps/terminal/index.js add "fix bug" --high      # with priority
node apps/terminal/index.js list [--done|--todo]      # filterable table
node apps/terminal/index.js done 2                    # mark task #2 done
node apps/terminal/index.js undo 2                    # reopen
node apps/terminal/index.js edit / remove             # interactive pickers
node apps/terminal/index.js stats                     # summary
```

## Accounts

- Register/sign in from the web client; your username and password also
  unlock the SSH TUI.
- Passwords are hashed with scrypt (per-user salt) and compared in
  constant time; sessions are random tokens in httpOnly cookies
  (7-day expiry), stored in `.data/sessions.json`.
- Every user gets an isolated task file (`.data/tasks/<userId>.json`) —
  nothing leaks between accounts. The CLI stays account-less and local.

## HTTP API

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/api/health` | liveness (public) |
| POST | `/api/auth/register` | `{ username, password }` → session |
| POST | `/api/auth/login` | `{ username, password }` → session |
| POST | `/api/auth/logout` | clears the session |
| GET | `/api/auth/me` | current user (401 if signed out) |
| GET | `/api/tasks` | `?status=done&priority=high` (session) |
| POST | `/api/tasks` | `{ text, priority }` (session) |
| PATCH | `/api/tasks/:id` | `{ text?, status?, priority? }` (session) |
| DELETE | `/api/tasks/:id` | (session) |
| GET | `/api/stats` | totals + percentDone (session) |

## Configuration

| Env | Default | Used by |
| --- | ------- | ------- |
| `TASKS_FILE` | `./tasks.json` | store (all surfaces) |
| `PORT` | `3000` | HTTP API + web |
| `SSH_PORT` | `2222` | SSH TUI |
| `HOST` | `0.0.0.0` | bind address |
| `SSH_HOST_KEY_DIR` | `.ssh-host` | host key persistence |
| `TODO_DATA_DIR` | `.data` | accounts, sessions, per-user task files |

## Screenshots (rendered output)

```
┌─ Tasks (3) ────────────────────
┌────────┬──────────────────────┬────────────┬────────────┐
│  #     │  Task                │  Status    │  Priority  │
├────────┼──────────────────────┼────────────┼────────────┤
│  1     │  buy milk            │  ○ todo    │  med       │
│  2     │  fix bug             │  ○ todo    │  high      │
│  3     │  old chore           │  ✔ done    │  low       │
└────────┴──────────────────────┴────────────┴────────────┘

┌─ Stats ────────────────────
┌────────────┬──────────┬──────────┬──────────┬──────────┐
│  Status    │  Count   │  High    │  Med     │  Low     │
├────────────┼──────────┼──────────┼──────────┼──────────┤
│  todo      │  2       │  1       │  1       │  0       │
│  done      │  1       │  0       │  0       │  1       │
│  total     │  3       │          │          │          │
└────────────┴──────────┴──────────┴──────────┴──────────┘

  Progress  ██████░░░░░░░░░░░░░░ 33% done
```

## Task file format

`tasks.json` is a JSON array. Current entries look like:

```json
[
  {
    "id": "b7c9d1e0-4f2a-4c8e-9a1b-2f3d4e5f6a7b",
    "text": "buy milk",
    "status": "todo",
    "priority": "med",
    "createdAt": "2026-09-26T12:00:00.000Z",
    "completedAt": null
  }
]
```

Older files that contain plain strings (e.g. `["buy milk"]`) still work:
entries are upgraded in memory when loaded and rewritten in the new
format the next time a change is saved.

## Development

```bash
npm run dev:backend    # API + web + SSH in one process (default ports)
npm run dev:terminal   # interactive CLI menu
npm run verify         # all five suites (CLI, API, SSH, accounts, web path)
npm run build:web      # refresh apps/frontend/dist (also runs on install)
```

Workspaces: `@todo/backend`, `@todo/terminal`, `@todo/frontend`,
`@todo/shared`. See [todo.md](todo.md) for the roadmap.
