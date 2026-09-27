# todo.sh v1.2.0

The rework release: the same product, now genuinely usable from **every**
surface. The web client becomes a dual view — a real GUI board plus the CRT
terminal — and due dates + tags run through the whole stack (grammar, stores,
REST, CLI, SSH, board).

## Highlights

- **Web dual view** — the web app now opens on a **board**: quick-add with
  priority/due-date/tags, click-to-complete, inline editing (text, priority,
  due, tags in one form), delete, filter chips (`all / open / done / overdue`
  plus one chip per tag), and a live stats strip. A toggle in the topbar
  switches to the **CRT terminal**; the choice is remembered per browser and
  both views stay in sync through the SSE change feed.
- **Due dates everywhere** — `add "ship" --due friday`, `due 2 tomorrow`,
  `due 2 clear`. Human expressions (`today`, `tomorrow`, weekday names,
  `2026-12-24`, `12-24`) resolve in the shared grammar; `list` shows a
  relative badge (`⏳ today`, `⚠ Oct 1 (12d ago)`) and overdue tasks get
  highlighted. Sorting is now: open first → priority → **soonest due first**.
- **Tags everywhere** — `--tag dev,ops` on add, `tag 2 home`, `untag 2 home`,
  `list +dev`. Tags are normalized (lowercase, deduped, leading `#` stripped,
  max 10) and stored on every task.
- **Overdue as data** — `list overdue`, an overdue count in `stats`, an
  `overdue` filter on `GET /api/tasks`, and a dedicated board chip.
- **Board and terminal are one product** — the board edits go through the
  same REST API; the terminal keeps speaking the shared grammar (served
  verbatim to the browser); SSH and CLI gained the same flags and commands,
  so a due date set in the browser shows up over SSH instantly.
- **Robustness fixes found during the rework**:
  - `createStoreFor` is now async and awaited — previously a Postgres
    deployment would have handed every request an unresolved promise
    (file mode masked this).
  - One store per user is created and cached, instead of a fresh store (and
    a fresh Postgres pool) per request; deleted accounts evict their cache.
  - Invalid `due` values are rejected (400 via API, usage error via CLI)
    instead of silently stored; corrupt `due`/`tags` in the JSON file surface
    as corruption, matching the store's existing guarantees.
- **CLI keeps its contract** — still account-less and offline-first, now with
  `--due`/`--tag` on `add`, `due`/`tag`/`untag` commands, tag/overdue list
  filters, and `--json` output that includes the new fields.

## Upgrade notes (v1.1.0 → v1.2.0)

- Task files gain two fields: `due` (`null` or ISO timestamp) and `tags`
  (array of lowercase strings). Nothing to migrate — files upgrade on load.
- Postgres deployments: the schema gains `due TIMESTAMPTZ` and
  `tags TEXT[]`; `CREATE TABLE IF NOT EXISTS` handles fresh installs. For
  existing tables run once:
  `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due TIMESTAMPTZ, ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';`
- `createStoreFor` changed from sync to async (await it). It already was
  async-shaped in Postgres mode; this makes the types honest.
- `GET /api/tasks` accepts `tag` and `overdue` query params; create/patch
  accept `due` and `tags` bodies.
- The web client's HTML/JS/CSS were restructured (new `#app` shell with a
  topbar and a board view). If you forked the old frontend, rebase on the
  new shell rather than patching it.

## Verification

All suites are green at release time:

```
npm run verify
# ✔ CLI smoke — incl. due/tag grammar, filters, overdue stats
# ✔ shared core — schema, sanitizers, filters, due-aware sort, grammar over a file store
# ✔ API + accounts integration — incl. due/tags CRUD, tag/overdue filters, validation
# ✔ SSH integration, real ssh2 client
# ✔ accounts flow check
# ✔ web-path check — due/tag grammar executed against REST exactly like the browser
```

Set `TEST_DATABASE_URL` to run the Postgres adapter suite as well.
