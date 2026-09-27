# Deployment configuration — everything you have to enter

The deployment *guide* is [DEPLOY.md](DEPLOY.md). This file is the other half:
the literal list of fields to fill in on the hosting dashboard, with the exact
value for each one, in the order the form asks for them. Copy the block, paste
it in, deploy.

Short version:

| | Render (recommended) | Vercel |
| --- | --- | --- |
| Can it run the API + web app? | Yes | **No** — serverless, see [Vercel](#vercel) |
| Cost | $0 (free plan + free Postgres) | n/a |
| SSH TUI | No | No |
| Fastest route | [Render free](#render-free-tier-0) | n/a |

---

## Render — free tier, $0

Render's free web service has **no persistent disk**, so everything that must
survive a restart lives in Postgres. Set `DATABASE_URL` and both the account
store and the task store move into the database.

### 1. The database (do this first)

Render's own Postgres is a 30-day trial; it is not the free path. Use any
free Postgres that has a permanent free tier — Neon is the easiest.

1. Create a free Postgres database.
2. Copy its **pooled** connection string (it contains `-pooler`). A direct
   string will run out of connections on a free tier.
3. Keep it open — you paste it into Render in step 2.

You need exactly one value from this step: a URL like
`postgresql://user:password@ep-xxx-pooler.region.aws.neon.tech/todo?sslmode=require`

### 2. Create the service

Dashboard → **New +** → **Blueprint**, point it at this repository, apply.
[render-free.yaml](../render-free.yaml) fills in everything that has a
known value; Render will prompt for the two `sync: false` ones.

Doing it by hand instead? Every field, in order:

| Field (Settings) | Value |
| --- | --- |
| Name | `todo-sh-free` (any name; it becomes part of the URL) |
| Region | closest to you *and* to your database |
| Branch | `master` |
| Language / Runtime | Node |
| Build Command | `npm install` |
| Start Command | `node apps/backend/server/start.js` |
| Health Check Path | `/api/health` |
| Instance Type | **Free** |

`npm install` is the *build* command on purpose: the `postinstall` hook runs
`scripts/build-web.mjs`, which copies the web client into
`apps/frontend/dist`. There is no separate build step and nothing else to
type.

**Do not** set a disk. The free plan cannot have one, and adding it forces a
paid instance.

### 3. Environment variables

Render → **Environment** → **Add Environment Variable**. Four values:

| Key | Value | Secret? |
| --- | --- | --- |
| `NODE_VERSION` | `22` | no |
| `TRUST_PROXY` | `1` | no |
| `DATABASE_URL` | your **pooled** Postgres URL from step 1 | **yes** |
| `PUBLIC_URL` | `https://todo-sh-free.onrender.com` (the URL Render assigns) | no |

Notes on each:

- `NODE_VERSION` — pins Node 22. Without it Render may pick a different major.
- `TRUST_PROXY=1` — Render terminates TLS and forwards `X-Forwarded-Proto`.
  Without it the session cookie is issued without `Secure` and browsers drop
  it, so sign-in appears to succeed and then forgets you.
- `DATABASE_URL` — the only value you have to supply. Mark it **Secret**.
  The schema (`users`, `sessions`, `tasks`) is created automatically on first
  boot; there is no migration step. Existing file data can be moved across
  with `npm run migrate:pg` if you need it (see [DEPLOY.md](DEPLOY.md)).
- `PUBLIC_URL` — display only, it appears in the boot log. Set it so the log
  tells you the real URL instead of `http://localhost:3000`.

### 4. Deploy and check

Hit **Create Instance** / **Apply**. Then open:

- `https://<your-service>.onrender.com/api/health` — must report
  `"store": "postgres"` and `"accounts": "postgres"`. If it says `file`,
  `DATABASE_URL` did not take.
- `https://<your-service>.onrender.com` — the web client. Register, sign in,
  add a task, reload: still signed in.

The first request after a deploy can take ~30 s while the instance wakes.

### 5. Keeping it awake

The free service sleeps after ~15 idle minutes and the first request after
that takes several seconds — it does not lose data, it just feels slow. If
that bothers you, point a free uptime monitor (UptimeRobot, Better Stack) at
`/api/health` every 10 minutes. It is optional; Postgres is the reason the
sleep is harmless.

### 6. From the command line instead

```bash
render services create \
  --name todo-sh-free --type web_service \
  --repo https://github.com/Madhurg2002/todo-cli \
  --runtime node \
  --build-command "npm install" \
  --start-command "node apps/backend/server/start.js" \
  --plan free \
  --env-var TRUST_PROXY=1 \
  --env-var DATABASE_URL='<pooled URL>' \
  --env-var PUBLIC_URL='https://todo-sh-free.onrender.com'

render services deploys create <service-id>
```

---

## Render — paid, with a disk

If you would rather keep the file store (a mounted disk, no external
database), use [render.yaml](../render.yaml): the `starter` plan plus a 1 GB
disk at `/var/data`. Same commands, and the environment table swaps one row:

| Key | Value |
| --- | --- |
| `NODE_VERSION` | `22` |
| `TODO_DATA_DIR` | `/var/data` |
| `TRUST_PROXY` | `1` |
| `PUBLIC_URL` | `https://todo-sh.onrender.com` |

`DATABASE_URL` is **not** set in this mode. Leave it unset — the file store
is used, and the accounts/sessions JSON files live on the disk. Drop the
`disk:` block from the blueprint if you want a disk-less paid instance, but
then you still need `DATABASE_URL` and you should be on the free plan instead.

---

## Vercel

**Vercel cannot run this app.** Not a settings problem — a shape problem.
Three things the app does that serverless functions do not allow:

1. It is a long-running process (`app.listen`) with open SSE streams; Vercel
   functions are request-scoped and freeze when nothing is in flight.
2. The SSH TUI needs a raw TCP listener on a separate port (`SSH_PORT`).
   Vercel ingress only speaks HTTP.
3. The filesystem is read-only, so the file store (accounts, sessions, tasks)
   cannot be written at all. Postgres would fix storage, but not 1 or 2.

So on Vercel, use it for a static landing page that links to the Render or
VPS deployment, and host the app itself there. That is the supported split.

For the record, these are the values the app *would* need if it were run on
a Node host with a long-lived process (Render, Fly.io, Railway, a VPS,
`node apps/backend/server/all.js`):

| Key | Value | Who sets it |
| --- | --- | --- |
| `PORT` | injected by the platform | **the platform — do not set it** |
| `HOST` | `0.0.0.0` | usually injected; set it if the host does not |
| `DATABASE_URL` | pooled Postgres URL | you (secret) |
| `TRUST_PROXY` | `1` | you |
| `PUBLIC_URL` | `https://your-app.example.com` | you |
| `NODE_VERSION` | `22` | you, if the platform lets you pin it |
| `SSH_PORT` | `2222` | you — only where raw TCP exists |

Two rules that are easy to get wrong:

- **Bind `0.0.0.0`.** The default is already that, but if you set `HOST`
  anywhere, it must not be `127.0.0.1` or the platform's health check will
  never reach the process and the deploy will be marked failed.
- **Never add `--omit=optional` to the install command.** `pg` is an
  optional dependency; omit it and Postgres mode silently falls back to files,
  which on a disk-less instance means every restart loses its accounts.

---

## Full environment variable reference

Every variable the code reads, and whether you need it in a hosted deploy.

### Required for a public deploy

| Var | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | pooled Postgres URL | selects Postgres for tasks **and** accounts **and** sessions. Secret. |
| `TRUST_PROXY` | `1` | behind TLS termination; this is what makes session cookies `Secure` |
| `PUBLIC_URL` | `https://…` | display-only, shown in the boot log |
| `NODE_VERSION` | `22` | not read by the app — read by the host's Node version picker |

### Supplied by the platform

| Var | Default | Notes |
| --- | --- | --- |
| `PORT` | `3000` | injected by Render/Vercel/most hosts; do not set it by hand |
| `HOST` | `0.0.0.0` | bind address; only set it if you are not getting `0.0.0.0` by default |

### File-store only (ignored when `DATABASE_URL` is set)

| Var | Default | Notes |
| --- | --- | --- |
| `TODO_DATA_DIR` | `.data` | where accounts/sessions/per-user task files live; set to the disk mount point |
| `TASKS_FILE` | `./tasks.json` | the CLI's task file |
| `SSH_HOST_KEY_DIR` | `.ssh-host` | SSH host key persistence |
| `SSH_PORT` | `2222` | SSH listener port; needs a host with raw TCP ingress |

### Behavioural toggles

| Var | Default | Notes |
| --- | --- | --- |
| `TODO_STORE` | auto | `file` forces the file store even when `DATABASE_URL` is set |
| `COOKIE_SECURE` | auto | `1` forces `Secure` on cookies; `TRUST_PROXY=1` is the normal way |
| `RATE_LIMIT` | on | `off` disables limits (auth 10/min, writes 120/min per IP). Leave on in public deploys. |
| `TODO_JSON` | — | `1` makes the CLI default to `--json` output |

### Test and tooling only — never set these in production

| Var | Default | Notes |
| --- | --- | --- |
| `TEST_DATABASE_URL` | `DATABASE_URL` | used by the test suites instead of the live database |
| `FREE_HOST_PORT` | `3901` | port for the `verify:free-host` deployment rehearsal |
| `PG_RUN_AS` | `daytona` | the local `run-with-pg.mjs` harness's sandbox user |
| `VERBOSE` | — | `1` makes the rehearsal script log every step |

---

## Troubleshooting the exact symptom

| Symptom | Cause | Fix |
| --- | --- | --- |
| `/api/health` reports `"store": "file"` | `DATABASE_URL` unset or not visible to the process | set it as a **Secret** env var, then redeploy |
| Sign-in appears to work, then the next request is signed out | cookie issued without `Secure` | set `TRUST_PROXY=1` |
| Deploy fails at "health check", site times out | process bound to `127.0.0.1` | set `HOST=0.0.0.0` |
| 500 on the first query after ~15 idle minutes | free DB and free host both cold | expected; [retries handle it](../packages/shared/pg-retry.js) — add an uptime monitor to avoid it |
| Accounts disappear after a redeploy | `TODO_STORE=file` set, or `DATABASE_URL` missing, on a disk-less instance | use the free blueprint and set `DATABASE_URL` |
| Web page loads but shows a blank board | `apps/frontend/dist` missing | build command must be `npm install` (postinstall builds it), not a bare `npm ci --omit=optional` |

For the full step-by-step, including the VPS/Docker path that also runs the
SSH TUI, see [DEPLOY.md](DEPLOY.md). For what the app does, see
[CAPABILITIES.md](CAPABILITIES.md).
