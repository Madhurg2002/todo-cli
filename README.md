# todo-cli

A terminal task manager for Node.js with colored tables, priorities and
done tracking. Tasks are stored in `tasks.json` in the directory you run
it from.

## Install

```bash
npm install
```

Optional global install exposes a `todo` command:

```bash
npm install -g .
todo list
```

## Usage

Run with no arguments for the interactive menu:

```bash
node index.js
```

Or pass commands directly:

```bash
node index.js add "buy milk"            # add with default (med) priority
node index.js add "fix bug" --high      # add with a priority
node index.js list                      # table of all tasks
node index.js done 2                    # mark task #2 as done
node index.js undo 2                    # reopen task #2
node index.js edit                      # pick a task and retype it
node index.js remove                    # pick a task and delete it
node index.js stats                     # summary by status + priority
node index.js help                      # command reference
```

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

- `npm start` — launch the interactive menu
- `npm run list` / `npm run stats` — quick non-interactive views
- `npm test` — smoke-test the non-interactive commands

See [todo.md](todo.md) for the roadmap and current status.
