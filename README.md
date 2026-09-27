# todo.sh

A task manager you can use three ways — a CLI that works with zero setup, a
browser app with a **board and a terminal view**, and an SSH TUI — all speaking
one command grammar over one shared store. Tasks carry text, priority, a
**due date** and **tags** on every surface.

```
CLI             →  todo add "fix bug"          scripts & locals (no account, no server)
Web (browser)   →  http://localhost:3000      CRT terminal UI (sign in)
SSH TUI         →  ssh -p 2222 localhost       live line-based session
```

**The CLI does not need an account or a running server.** `npm install` and
`todo list` works immediately against a local `tasks.json`. Accounts exist
only for the web and SSH surfaces, which share one login and one list.

## Capability matrix

| Capability | CLI | Web board | Web terminal | SSH TUI | REST API |
| ------------------------ | :-: | :-------: | :----------: | :-----: | :------: |
| add / list / done / undo | ✔ | ✔ | ✔ | ✔ | ✔ |
| rm / edit                | ✔ | ✔ | ✔ | ✔ | ✔ |
| due dates (set/clear)    | ✔ | ✔ | ✔ | ✔ | ✔ |
| tags (add/remove/filter) | ✔ | ✔ | ✔ | ✔ | ✔ |
| overdue view + stats     | ✔ | ✔ | ✔ | ✔ | ✔ |
| stats + progress bar     | ✔ | ✔ | ✔ | ✔ | ✔ |
| filter (status/priority) | ✔ | ✔ | ✔ | ✔ | ✔ |
| `--json` output          | ✔ | via API | via API | via API | ✔ |
| change password          | — | ✔ (⚙ settings) | ✔ (⚙ settings) | — | ✔ |
| list / kill sessions     | — | ✔ (⚙ settings) | ✔ (⚙ settings) | — | ✔ |
| delete account           | — | ✔ (⚙ settings) | ✔ (⚙ settings) | — | ✔ |
| live cross-surface sync  | — | ✔ (SSE feed) | ✔ (SSE feed) | ✔ (re-list) | ✔ |
| works fully offline      | ✔ | — | — | — | — |

One grammar, many surfaces: the CLI, the SSH stream and the browser terminal
all parse and execute through `runCommand`/`parseCommand` in
`@todo/shared/commands`. They differ only in the io sink (stdout vs chalk
stream vs DOM spans) and the store adapter (local file vs per-user file vs
REST calls).

## Structure (npm workspaces)

```
apps/
  backend/     @todo/backend    REST API, SSH TUI, combined entrypoint
    server/    express app, ssh2 server, shared-grammar bundle
    test/      api + ssh integration suites
  terminal/    @todo/terminal   the todo CLI (bin: todo)
    test/      CLI smoke suite
  frontend/    @todo/frontend   web client — board + CRT terminal dual view
    public/    index.html, style.css, app.js (source)
    dist/      build output served by the backend
packages/
  shared/      @todo/shared     the shared core
    store.js     task store: file adapter, Postgres adapter, filters, stats
    commands.js  pure command grammar: parseCommand, runCommand
    accounts.js  users, scrypt hashing, sessions, password/account lifecycle
    jsonfile.js  atomic JSON writes + cross-process file locking
```

## Quick start

Requires Node 18+. No services, no API keys — everything is local by default.

```bash
git clone <this-repo>
cd todo-cli
npm install            # installs deps AND builds the frontend automatically

todo help              # or: npm run todo — works right away, no account
todo add "ship it" --high
todo list --json

npm run dev:backend    # optional: API + web on :3000, SSH on :2222
```

Then open http://localhost:3000, create an account, and the same
credentials work over SSH:

```bash
ssh -p 2222 you@localhost
# try: add "task" --high  ·  list  ·  done 1  ·  stats
```

First run creates `tasks.json` (CLI data), `.data/` (accounts, sessions,
per-user task files) and `.ssh-host/` (generated SSH host key) — all
gitignored, never committed.

### Install the `todo` command globally (optional)

```bash
npm link               # puts `todo` on your PATH from this checkout
# or, after publishing: npm install -g todo.sh
```

Without linking, use `npm run todo -- <args>` or
`node apps/terminal/index.js`.

## CLI

```bash
todo add "buy milk"                    # default (med) priority
todo add "fix bug" --high
todo add "ship v1.2" --high --due friday --tag dev,ops
todo list                              # sorted: priority, then soonest due
todo list todo | list done | list --high | list +dev | list overdue
todo done 2  ·  todo undo 2  ·  todo rm 2
todo edit 2 "new text"
todo due 2 tomorrow                    # today/tomorrow/fri/2026-12-24
todo due 2 clear                       # remove the due date
todo tag 2 home,ops  ·  todo untag 2 home
todo stats                             # includes an overdue count
todo list --json                       # machine-readable output
```

`--json` (or `TODO_JSON=1`) prints `{"ok":bool,"lines":[{cls,text},...]}` —
exit code is 0/1 matching `ok`, so it is safe for scripts and status bars:

```bash
todo stats --json | jq '.ok'
```

## Accounts

- Register/sign in from the web client; your username and password also
  unlock the SSH TUI.
- Passwords are scrypt-hashed (per-user salt) and compared in constant
  time; sessions are random 256-bit tokens in httpOnly cookies
  (7-day expiry, `Secure` when served over TLS).
- Every user gets an isolated store (`.data/tasks/<userId>.json`, or a
  Postgres row set when `DATABASE_URL` is set) — nothing leaks between
  accounts.
- **Account management** lives in the web client's ⚙ settings panel:
  change password (revokes all other sessions), see and kill active
  sessions, and delete the account entirely (requires password, wipes
  sessions and tasks).
- Minimum password length is 8 characters; register/login endpoints are
  rate-limited (10/min/IP).

## HTTP API

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/api/health` | liveness + version + store kind (public) |
| POST | `/api/auth/register` | `{ username, password }` → session + token |
| POST | `/api/auth/login` | `{ username, password }` → session + token |
| POST | `/api/auth/logout` | clears the session |
| GET | `/api/auth/me` | current user (401 if signed out) |
| GET | `/api/auth/sessions` | live sessions for this account |
| DELETE | `/api/auth/sessions/:id` | kill one session |
| POST | `/api/auth/password` | `{ currentPassword, newPassword }` |
| DELETE | `/api/auth/account` | `{ password }` — deletes everything |
| GET | `/api/events` | SSE change feed (per-user) |
| GET | `/api/tasks` | `?status=done&priority=high&tag=dev&overdue=true` |
| POST | `/api/tasks` | `{ text, priority, due?, tags? }` |
| PATCH | `/api/tasks/:id` | `{ text?, status?, priority?, due?, tags? }` |
| DELETE | `/api/tasks/:id` | |
| GET | `/api/stats` | totals, percentDone, overdue |

**Bearer tokens:** register/login also return a `token` (the same value as
the cookie). Shell scripts and status bars can call the API without a
cookie jar:

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"you","password":"…"}' | jq -r .token)

curl -s localhost:3000/api/tasks -H "Authorization: Bearer $TOKEN"
```

## Storage

Two adapters, one interface, selected at boot:

- **File store** (default): JSON files under `.data/`, atomic writes
  (tmp + rename) and per-file advisory locks so concurrent sessions —
  server, SSH, another CLI process — queue instead of overwriting each
  other. This is what the previous release got wrong under concurrency;
  it is now tested.
- **Postgres store**: set `DATABASE_URL` (and don't set `TODO_STORE=file`)
  and every surface uses Postgres. Migrate existing JSON data with
  `npm run migrate:pg`. Requires `npm install pg` (kept out of the default
  dependency tree on purpose).

Set `TODO_STORE=file` to force the file store even with `DATABASE_URL`
present.

## Configuration

| Env | Default | Used by |
| --- | ------- | ------- |
| `TASKS_FILE` | `./tasks.json` | CLI store file |
| `PORT` | `3000` | HTTP API + web |
| `SSH_PORT` | `2222` | SSH TUI |
| `HOST` | `0.0.0.0` | bind address |
| `SSH_HOST_KEY_DIR` | `.ssh-host` | host key persistence |
| `TODO_DATA_DIR` | `.data` | accounts, sessions, per-user task files |
| `DATABASE_URL` | — | selects the Postgres store |
| `TODO_STORE` | auto | `file` forces the file store |
| `PUBLIC_URL` | — | display URL in boot log (set when behind TLS) |
| `TRUST_PROXY` | — | `1` when behind a reverse proxy (enables `Secure` cookies) |
| `COOKIE_SECURE` | auto | `1` forces `Secure` on cookies |
| `RATE_LIMIT` | on | `off` disables rate limiting (tests, trusted LAN) |
| `TODO_JSON` | — | `1` makes the CLI default to `--json` |

## Hosting it

Full deployment guide: [DEPLOY.md](DEPLOY.md) — one-click Render blueprint
(`render.yaml`, disk-backed, ~$7/mo), the $0 free-tier path, and the
VPS/Docker setup that also hosts the SSH TUI.

### TLS in front of HTTP

The server speaks plain HTTP; put TLS in front of it on a VPS. Two options:

**Caddy (automatic certificates):**

```
todo.example.com {
    reverse_proxy localhost:3000
}
```

Run the app with `TRUST_PROXY=1 PUBLIC_URL=https://todo.example.com` —
`Secure` cookies turn on automatically and SSE passes through.

**nginx:**

```nginx
server {
    listen 443 ssl;
    server_name todo.example.com;
    ssl_certificate     /etc/letsencrypt/live/todo.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/todo.example.com/privkey.pem;
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header X-Forwarded-Proto https;   # lights up Secure cookies
        proxy_buffering off;                        # required for SSE (/api/events)
        proxy_read_timeout 3600s;
    }
}
```

Also keep SSH off the public internet or tunnel it; the SSH TUI uses
password auth and is intended for personal use.

## Docker

```bash
docker build -t todo.sh .
docker run -p 3000:3000 -p 2222:2222 -v todo-data:/app/.data todo.sh
# Postgres mode:
docker run -p 3000:3000 -p 2222:2222 -e DATABASE_URL=postgres://… todo.sh
```

## Development

```bash
npm run dev:backend    # API + web + SSH in one process (default ports)
npm run todo           # the CLI
npm run verify         # all six suites (CLI, shared core, API, SSH, accounts, web path)
npm run build:web      # refresh apps/frontend/dist (also runs on install)
```

CI (`.github/workflows/ci.yml`) runs all suites on Node 20 and 22 for every
push and pull request.

## Task file format

`tasks.json` is a JSON array:

```json
[
  {
    "id": "b7c9d1e0-4f2a-4c8e-9a1b-2f3d4e5f6a7b",
    "text": "buy milk",
    "status": "todo",
    "priority": "med",
    "due": "2026-10-01T17:00:00.000Z",
    "tags": ["home"],
    "createdAt": "2026-09-26T12:00:00.000Z",
    "completedAt": null
  }
]
```

`due` is `null` or an ISO timestamp, `tags` is always an array of lowercase
words (leading `#` is stripped, max 10). Older files without these fields
upgrade automatically on load; entries that carry an invalid `due` are
treated as corruption and reported instead of silently rewritten.

Older files that contain plain strings (e.g. `["buy milk"]`) still work:
entries are upgraded in memory when loaded and rewritten in the new
format the next time a change is saved.

## License

MIT — see [LICENSE](LICENSE).

Workspaces: `@todo/backend`, `@todo/terminal`, `@todo/frontend`,
`@todo/shared`. See [todo.md](todo.md) for the roadmap.
