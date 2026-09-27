# Documentation

Everything long-form lives here. The [README](../README.md) stays at the
repository root — it is what GitHub and npm show — and links down to this
folder.

| Document | What it answers |
| -------- | --------------- |
| [DEPLOY.md](DEPLOY.md) | How to host it: the two Render blueprints (disk-backed ~$7/mo, Postgres-backed **$0**), the CLI one-liner, and the VPS/Docker path that also runs the SSH TUI. |
| [DEPLOY_CONFIG.md](DEPLOY_CONFIG.md) | The exact field-by-field list of what to type on Render or Vercel — build/start commands, the four environment variables, and every env var the app reads. |
| [CAPABILITIES.md](CAPABILITIES.md) | What todo.sh does today, what it is wired to do next, and the integration candidates worth evaluating. |
| [todo.md](todo.md) | The roadmap as a running status log, plus the hosting analysis of which free tiers work and why. |
| [RELEASE_NOTES.md](RELEASE_NOTES.md) | Per-release changes. |

## Where things are

```
apps/backend/server/    express app (REST + SSE + static web) and the SSH listener
apps/frontend/          the web client source (public/) and its build output (dist/)
apps/terminal/          the `todo` CLI
packages/shared/        store.js, accounts.js, commands.js, constants.js, pg-retry.js
render.yaml             Render blueprint, disk-backed (paid plan)
render-free.yaml        Render blueprint, Postgres-backed ($0 free plan)
```
