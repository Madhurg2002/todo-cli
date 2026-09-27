# Deploying todo.sh

Three ways to host it. The app is one Node process serving the web UI + REST
API (`/` and `/api/*`); the optional SSH TUI needs raw TCP and is therefore
self-host/VPS-only.

## Option 1 — Render with a disk (~$7/mo, zero code changes)

The file store (accounts, sessions, tasks) lives on a mounted disk and simply
survives deploys and restarts. The repo ships a Render blueprint, so this is
one click:

1. In the Render dashboard: **New → Blueprint**, select `Madhurg2002/todo-cli`
   (branch `master`). Every field comes pre-filled from `render.yaml`.
2. When prompted, fill the `PUBLIC_URL` variable with the URL Render assigns
   (e.g. `https://todo-sh.onrender.com`) — display-only, used in the boot log.
3. Create the Web Service. First deploy runs `npm install` (which also builds
   the frontend) and starts `node apps/backend/server/start.js`.
4. Open the URL, register an account, and use the board or terminal.

What the blueprint sets up:

| Setting | Value | Why |
| --- | --- | --- |
| Instance | `starter` | required for disks; free tier has no disk and sleeps |
| Disk | 1 GB at `/var/data` | holds `TODO_DATA_DIR` (accounts, sessions, tasks) |
| Health check | `/api/health` | public, versioned liveness endpoint |
| `TRUST_PROXY=1` | env | Render terminates TLS → session cookies get `Secure` |
| Start command | `node apps/backend/server/start.js` | HTTP + API + static web (no SSH listener) |

Every push to `master` auto-deploys. The CLI keeps working locally and
offline exactly as before — hosting only affects the web/REST surface.

## Option 2 — Render free tier ($0, needs code work first)

Free instances have **no persistent disk** and **spin down after ~15 idle
minutes**. Before using it:

1. **Port accounts and sessions to Postgres.** Tasks already support
   `DATABASE_URL`, but accounts/sessions are file-based — on the free tier
   every spin-down would wipe logins. This is the one blocking refactor.
2. Create a free Postgres (e.g. Tiger Cloud or Neon — both have no-expiry
   free tiers, unlike Render's 30-day free database) and set `DATABASE_URL`.
3. Add a free uptime pinger (e.g. UptimeRobot hitting `/api/health` every
   10 minutes) to avoid spin-downs and cold starts.

Then deploy the same service as Option 1 but on the free plan, **without**
the disk, and with `TODO_STORE` left at its default (Postgres is selected
automatically when `DATABASE_URL` is set).

## Option 3 — VPS / Docker (full feature set, including SSH)

The only way to get the SSH TUI hosted: a tiny VPS (~$4–6/mo) with Docker.

```bash
docker build -t todo.sh .
docker run -d --name todo \
  -p 80:3000 -p 2222:2222 \
  -v todo-data:/app/.data \
  -e TRUST_PROXY=1 -e PUBLIC_URL=https://todo.example.com \
  todo.sh
```

Put Caddy or nginx in front for TLS (see the README's TLS section —
`proxy_buffering off` matters for SSE). Keep 2222 firewalled or tunneled;
SSH auth is password-based and meant for personal use.

## What about Vercel?

Vercel can't run this app: no persistent process, no raw TCP, read-only
filesystem, and serverless function time caps. Its only sensible role is
hosting a static marketing/landing page that links "Sign in" to the Render
or VPS deployment. The app itself does not need it.

## Environment variables reference

| Var | Set it to | Notes |
| --- | --- | --- |
| `TODO_DATA_DIR` | `/var/data` (Render) or `/app/.data` (Docker) | where accounts/sessions/tasks live |
| `TRUST_PROXY` | `1` | behind Render/VPS TLS proxy; enables `Secure` cookies |
| `PUBLIC_URL` | your public URL | display-only (boot log) |
| `DATABASE_URL` | Postgres connection string | optional; switches the task store to Postgres |
| `TODO_STORE` | `file` | optional; forces the file store even with `DATABASE_URL` |
| `RATE_LIMIT` | unset | leave off in prod (limits: auth 10/min, writes 120/min per IP) |
