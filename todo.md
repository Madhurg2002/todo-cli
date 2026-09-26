# todo-cli — Roadmap & Status

A terminal task manager for Node.js. Tasks live in `tasks.json` in the working
directory. Run `node index.js` for the interactive menu, or pass a command
directly.

## ✅ What's done

- **Core CLI (Node 22, ESM)** — command router in `index.js` with `add`, `list`,
  `edit`, `remove`, plus an interactive inquirer menu loop.
- **Add** — `node index.js add "task text"` for one-shot adds; falls back to an
  interactive prompt when no text is given.
- **List** — prints numbered tasks from `tasks.json`, offers an update flow.
- **Edit** — select a task, retype its description (pre-filled default).
- **Remove** — select a task from a list, confirm, delete.
- **Persistence** — `utils/loadTasks.js` / `utils/saveTasks.js` read and write
  `tasks.json` (pretty-printed JSON array).
- **Windows launcher** — `todo.bat` wrapper.
- **Dependency** — `inquirer@12` for prompts.

## 🐛 Known issues (to fix)

- [ ] `index.js` top half is dead commented-out code from the first version.
- [ ] `utils/index.js` barrel imports a non-existent `common.mjs` — the barrel
      is broken and unused.
- [ ] Dead imports (`fs`, `path`) in `addTask.js` / `updateTask.js`.
- [ ] Menu item "Update a task" maps to no command (`update` vs `edit`) →
      prints "Invalid command".
- [ ] `edit` from the menu calls `updateTask()` with no index → corrupts the
      array (`tasks[undefined] = ...`).
- [ ] Interactive add (`readline`) never returns to the menu loop.
- [ ] `list` always nags with "Would you like to update a task?".
- [ ] No error handling for a missing/corrupted `tasks.json` (JSON.parse crash).
- [ ] Unbounded recursion in the menu loop (`main()` calls itself).
- [ ] No `--help`, no version, no error exit codes.
- [ ] Tasks are plain strings — no status, priority, or timestamps.

## 🧱 Planned revamp

### 1. Cleanup pass
- Delete dead code, fix/remove the broken barrel, drop unused imports.
- Rewrite the menu loop as a `while` loop with proper exit.

### 2. Terminal UI revamp
- `chalk` for colors everywhere (headers, hints, badges).
- Box-drawing table for `list`: `#`, status badge, priority, date, task text.
- Empty state, success/error messages, aligned columns.

### 3. Task model upgrade
- Task objects: `{ id, text, status: todo|done, priority: low|med|high, createdAt, completedAt }`.
- Graceful migration: old string-only `tasks.json` entries upgrade on load.

### 4. Commands
- `add [text] [--high|--med|--low]` — with flags, prompt otherwise.
- `list [--all|--done|--pending]` — pure listing, no nagging prompt.
- `done <n>` / `undo <n>` — toggle completion.
- `edit` — select then retype.
- `remove` — multi-select checkboxes, bulk delete.
- `stats` — counts by status/priority.
- `--help`, `--version`.

### 5. Polish
- `bin` + `scripts` in `package.json` so it runs as `todo`.
- README with usage examples.
- Smoke-test script (`npm test`-style) exercising the non-interactive paths.
- Keep this file's status section in sync.

## Status

| Area            | State |
| --------------- | ----- |
| Core commands   | partial (broken paths, see known issues) |
| Storage         | works, plain strings |
| Terminal UI     | plain console.log |
| Docs            | none |
| Tests           | none |
