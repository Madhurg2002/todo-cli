# todo.sh

A task manager you can ssh into — plus a terminal-style web client and a
classic CLI, all over one shared store.

```
Web (browser)   →  http://localhost:3000      CRT terminal UI
SSH TUI         →  ssh -p 2222 localhost       live line-based session
CLI             →  node index.js list          scripts & locals
```

## Quick start

```bash
npm install
npm run build:web     # copy static web assets to web/dist
npm run server        # API + web on :3000, SSH on :2222
```

Then open http://localhost:3000 in a browser, or connect from a real
terminal:

```bash
ssh -p 2222 localhost
# try: add "ship it" --high   ·   list   ·   done 1   ·   stats
```

## Surfaces

### 1. Web terminal (`/`)
A terminal.shop-style CRT client. Type commands (`add "task" --high`,
`list`, `done 1`, `stats`, `help`) into the prompt; everything talks to
the REST API below.

### 2. SSH TUI
`ssh -p 2222 <host>` lands you in a live session backed by the same
store: banner, task table with progress bar, and the same command set.
A persistent host key is generated under `.ssh-host/` on first run.

### 3. CLI

```bash
node index.js add "buy milk"            # add with default (med) priority
node index.js add "fix bug" --high      # add with a priority
node index.js list [--done|--todo]      # table of tasks (filterable)
node index.js done 2                    # mark task #2 as done
node index.js undo 2                    # reopen task #2
node index.js edit / remove             # interactive pickers
node index.js stats                     # summary by status + priority
node index.js                           # interactive menu
```

## HTTP API

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/api/health` | liveness |
| GET | `/api/tasks` | `?status=done&priority=high` |
| POST | `/api/tasks` | `{ text, priority }` |
| PATCH | `/api/tasks/:id` | `{ text?, status?, priority? }` |
| DELETE | `/api/tasks/:id` | |
| GET | `/api/stats` | totals + percentDone |

## Configuration

| Env | Default | Used by |
| --- | ------- | ------- |
| `TASKS_FILE` | `./tasks.json` | store (all surfaces) |
| `PORT` | `3000` | HTTP API + web |
| `SSH_PORT` | `2222` | SSH TUI |
| `HOST` | `0.0.0.0` | bind address |
| `SSH_HOST_KEY_DIR` | `.ssh-host` | host key persistence |

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
npm start            # interactive CLI menu
npm run server       # HTTP API + web (PORT, default 3000)
npm run ssh          # standalone SSH TUI (SSH_PORT, default 2222)
npm run server:all   # API + web + SSH in one process
npm test             # CLI smoke suite
npm run test:api     # API integration tests
npm run test:ssh     # SSH integration tests
```

Architecture: `store.js` (shared data layer) ← `index.js` (CLI),
`server/index.js` (API), `server/ssh.js` (SSH session),
`web/public` (browser client). See [todo.md](todo.md) for the roadmap.
