#!/usr/bin/env node
/**
 * todo CLI.
 *
 * Every command is parsed by @todo/shared/commands (parseCommand via
 * runCommand) and executed against the same shared store the server
 * uses — identical grammar to the web terminal and the SSH TUI.
 *
 * Usage:
 *   todo add "task" [--high|--med|--low]
 *   todo list
 *   todo done N | undo N | rm N
 *   todo edit N "new text"
 *   todo stats | whoami | help
 *
 * Output is human by default; --json (or TODO_JSON=1) prints
 * machine-readable JSON for scripts and status bars:
 *   { "ok": bool, "lines": [{ "cls": "ok", "text": "..." }, ...] }
 */
import { runCommand } from '@todo/shared/commands';
import { createFileStore, StoreError } from '@todo/shared/store';

const asJson = process.argv.includes('--json') || process.env.TODO_JSON === '1';
const args = process.argv.slice(2).filter((a) => a !== '--json');

const styles = {
  ok: (s) => `\x1b[32m${s}\x1b[0m`,
  err: (s) => `\x1b[31m${s}\x1b[0m`,
  warn: (s) => `\x1b[33m${s}\x1b[0m`,
  head: (s) => `\x1b[36m\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  done: (s) => `\x1b[2m\x1b[9m${s}\x1b[0m`,
  bar: (s) => `\x1b[36m${s}\x1b[0m`,
};

function printLines(lines) {
  for (const { cls, text } of lines) {
    const paint = styles[cls] ?? ((s) => s);
    console.log(paint(text));
  }
}

function exitCodeFor(lines) {
  return lines.some((l) => l.cls === 'err') ? 1 : 0;
}

function printHelp() {
  console.log(
    [
      'todo — a task manager in your terminal',
      '',
      'usage: todo <command> [args] [--json]',
      '',
      'commands:',
      '  add "task" [--high|--med|--low] [--due DATE] [--tag a,b]',
      '  list [todo|done|--high|--med|--low|+tag|overdue]',
      '  done N | undo N | rm N           complete / reopen / delete',
      '  edit N "new text"                retype task N',
      '  due N DATE                       set due (today, tomorrow, fri,',
      '                                   2026-10-01 — or: due N clear)',
      '  tag N a,b | untag N a            add / remove tags',
      '  stats                            counts by status and priority',
      '  whoami                           shows the local (account-less) identity',
      '  help                             this message',
      '',
      'add --json (or set TODO_JSON=1) for machine-readable output.',
      'The CLI works fully offline: no account, no server required.',
    ].join('\n')
  );
}

async function main() {
  const raw = args.join(' ').trim();

  if (!raw || raw === 'help' || raw === '--help' || raw === '-h') {
    printHelp();
    return;
  }

  const lines = [];
  const ctx = {
    store: createFileStore(),
    username: null, // CLI sessions are local; accounts live on web/SSH
    write(cls, text) {
      lines.push({ cls, text });
    },
    exit() {},
  };

  try {
    await runCommand(raw, ctx);
  } catch (err) {
    if (err instanceof StoreError) {
      console.error(`✗ ${err.message}`);
      console.error('  Fix or delete the file; no changes were made.');
      process.exitCode = 1;
      return;
    }
    throw err;
  }

  if (asJson) {
    console.log(JSON.stringify({ ok: exitCodeFor(lines) === 0, lines }));
  } else {
    printLines(lines);
  }
  process.exitCode = exitCodeFor(lines);
}

main().catch((err) => {
  console.error(err?.stack ?? String(err));
  process.exitCode = 1;
});
