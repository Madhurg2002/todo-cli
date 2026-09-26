# todo.sh v1.0.0

A task manager you can `ssh` into — a CRT-style web terminal, an SSH TUI,
and a classic CLI, all speaking one command grammar over one shared core.

## Highlights

- **Three surfaces, one grammar** — the browser terminal, the SSH TUI and
  the CLI all execute through `runCommand` in `@todo/shared/commands`.
  Only the io sink (DOM vs chalk stream) and the store adapter (REST vs
  per-user JSON file) differ.
- **Accounts** — register once in the browser and the same credentials
  unlock `ssh -p 2222 you@host`. Passwords are scrypt-hashed with
  per-user salts, sessions are httpOnly cookies, and every account gets
  an isolated task file.
- **Terminal-shop feel** — box-drawing tables, progress bars, priority
  badges and a CRT web client.
- **Self-hosted** — `npm install` then `npm run dev:backend`. No services,
  no API keys, no cloud dependency; all data stays in local JSON files.

## Commands

`list` · `add TEXT [--high|--med|--low]` · `done N` · `undo N` · `rm N` ·
`edit N TEXT` · `stats` · `whoami` · `help` · `clear` · `exit`

## Layout

```
apps/backend    @todo/backend    REST API, SSH server, combined entrypoint
apps/terminal   @todo/terminal   interactive CLI
apps/frontend   @todo/frontend   web terminal client
packages/shared @todo/shared     store, renderer, command grammar, accounts
```

## Verification

`npm run verify` runs the CLI smoke suite, API + accounts integration
tests, SSH integration tests, an accounts flow check and a web-path
check — all green at release time.
