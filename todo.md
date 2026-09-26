# todo-cli — Roadmap & Status

A terminal task manager for Node.js. Tasks live in `tasks.json` in the working
directory. Run `node index.js` for the interactive menu, or pass a command
directly. See [README.md](README.md) for full usage.

## ✅ What's done

### Core
- [x] Command router in `index.js` with `add`, `list`, `done`, `undo`, `edit`,
      `remove`, `stats`, `help` + interactive inquirer menu loop (while-loop,
      no recursion, proper exit).
- [x] Task model upgrade: `{ id, text, status: todo|done, priority: low|med|high,
      createdAt, completedAt }` with graceful migration of legacy string-only
      `tasks.json` files (upgraded on load, rewritten on next save).
- [x] Friendly errors for corrupted / non-list `tasks.json` instead of
      `JSON.parse` crashes; no writes when the file is unreadable.
- [x] Correct exit codes (`1` on bad command / bad task number).

### Terminal UI
- [x] `chalk`-powered colored output everywhere (headers, badges, hints,
      success/warn/error feedback).
- [x] Box-drawing table renderer (`utils/render.js`): auto column widths,
      ANSI-safe truncation with ellipsis, per-cell coloring.
- [x] `list` table with `#`, Task, Status (`✔ done` / `○ todo`), Priority
      (red/yellow/gray).
- [x] `stats` table with counts by status and priority + `█░` progress bar.
- [x] Empty states with actionable hints (`add one with node index.js add "task"`).
- [x] Cancellable task pickers (with separators) in edit/remove; strikethrough
      for removed tasks.

### Commands
- [x] `add "text" [--high|--med|--low]` — inline priority flags; falls back to
      an interactive prompt (promise-based, menu-loop safe) when no text.
- [x] `list` / `list --done` / `list --todo` (`--pending`) — pure listings with
      filtered titles; filtered views renumber from 1.
- [x] `done <n>` / `undo <n>` — completion toggling, sets/clears `completedAt`.
- [x] `edit` — pick a task, retype description (pre-filled), rejects empty and
      no-op edits (fixes the old `tasks[undefined]` corruption bug).
- [x] `remove` — pick, confirm, delete.
- [x] `stats` — summary table + progress percentage.
- [x] `help` — command reference.

### Packaging & docs
- [x] `bin: { todo }` for `npm install -g .`, `engines >= 18`, npm scripts
      (`start`, `list`, `stats`, `test`).
- [x] README with install, usage, rendered-output examples and data format.
- [x] Smoke tests (`npm test`) covering help, add flags, list, done/undo exit
      codes, stats, legacy migration, corrupted-file handling — run in a
      throwaway temp dir.
- [x] Windows launcher (`todo.bat`) and npm lockfile committed.

## 🧹 Cleaned up along the way

- [x] Deleted the commented-out first-version CLI block in `index.js`.
- [x] Fixed the broken `utils/index.js` barrel (imported a non-existent
      `common.mjs`).
- [x] Removed unused `fs`/`path` imports and duplicate import blocks.
- [x] Menu items now map to real commands (`Edit a task` → `edit`).

## 🔭 Ideas / not needed yet

- [ ] Bulk remove with checkbox multi-select.
- [ ] `edit <n>` / `remove <n>` direct-index variants without prompts.
- [ ] Sort options for `list` (by priority, by created date).
- [ ] Due dates and overdue highlighting.
- [ ] `--json` output flag for scripting.
- [ ] Config file for default priority / storage location.
- [ ] Archive of completed tasks instead of in-list strikethrough.

## Status

| Area            | State |
| --------------- | ----- |
| Core commands   | ✅ complete |
| Storage         | ✅ rich objects + legacy migration |
| Terminal UI     | ✅ chalk tables, badges, progress bar |
| Docs            | ✅ README + roadmap |
| Tests           | ✅ smoke suite (`npm test`) |

All smoke tests passing. Run `npm test` to verify locally.
