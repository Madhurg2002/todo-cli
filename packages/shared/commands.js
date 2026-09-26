/**
 * Command grammar shared by every surface: the REST API consumers, the
 * SSH TUI and the browser terminal. This module is pure — it never
 * touches the filesystem or the network. Persistence is injected as
 * `ctx.store` (createFileStore for Node surfaces, a REST adapter in the
 * browser); output is injected as `ctx.write`.
 *
 * Commands: list | add TEXT [--high|--med|--low] | done N | undo N |
 *           rm N | edit N TEXT | stats | whoami | help | clear | exit
 */

export const HELP_ENTRIES = [
  '  list                          show all tasks with progress',
  '  add TEXT [--high|--med|--low] create a task',
  '  done N                        mark task N done',
  '  undo N                        reopen task N',
  '  rm N                          delete task N',
  '  edit N TEXT                   retype task N',
  '  stats                         counts by status and priority',
  '  whoami                        show the signed-in account',
  '  help                          this message',
];

/** Parse a command line into normalized pieces. */
export function parseCommand(raw) {
  const [cmd, ...rest] = String(raw ?? '').trim().split(/\s+/);
  const arg = rest.join(' ');

  let text = arg;
  let priority = 'med';
  if (cmd === 'add') {
    text = arg
      .replace(/--(high|med|medium|low)\b/g, (_m, p) => {
        priority = p === 'medium' ? 'med' : p;
        return '';
      })
      .trim();
  }
  // `edit 2 new text` → index 2, text "new text"
  let index = Number.parseInt(rest[0], 10);
  if (cmd === 'edit') {
    text = rest.slice(1).join(' ').trim();
  }

  return { cmd, arg, text, priority, index };
}

/** Build the ASCII progress bar shared by terminal renderers. */
export function progressBar(done, total, { width = 20 } = {}) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const filled = Math.min(width, Math.round(pct / (100 / width)));
  return { pct, filled, empty: width - filled };
}

/**
 * Execute a command.
 * @param {string} raw user input line
 * @param {object} ctx
 * @param {(cls: string, text: string) => void} ctx.write emit one output line
 * @param {{ list, create, update, setStatus, remove, stats }} ctx.store async adapter
 * @param {string} [ctx.username] signed-in account for `whoami`
 * @param {() => void} [ctx.clear] clear the screen
 * @param {() => void} [ctx.exit] end the session
 */
export async function runCommand(raw, ctx) {
  const { cmd, text, priority, index } = parseCommand(raw);
  const { store } = ctx;
  const fail = (msg) => ctx.write('err', `  ✗  ${msg}`);

  switch (cmd) {
    case '':
      return;

    case 'help':
    case '?':
      ctx.write('head', 'Commands');
      HELP_ENTRIES.forEach((entry) => ctx.write('dim', entry));
      return;

    case 'list':
    case 'ls': {
      const { tasks } = await store.list();
      if (tasks.length === 0) {
        ctx.write('warn', '  ⚠  No tasks yet. Try: add "my first task"');
        return;
      }
      const doneCount = tasks.filter((t) => t.status === 'done').length;
      tasks.forEach((t, i) => {
        const isDone = t.status === 'done';
        const num = String(i + 1).padStart(2);
        const badge = isDone ? '✔' : '○';
        const pri = t.priority === 'high' ? '!!!' : t.priority === 'med' ? '!!' : '·';
        ctx.write(isDone ? 'done' : '', `  ${num} ${badge} ${t.text} [${t.priority}] ${pri}`);
      });
      const { pct, filled, empty } = progressBar(doneCount, tasks.length);
      ctx.write('bar', `  ${'█'.repeat(filled)}${'░'.repeat(empty)} ${pct}% (${doneCount}/${tasks.length} done)`);
      return;
    }

    case 'add': {
      if (!text) {
        fail('usage: add "task text" [--high|--med|--low]');
        return;
      }
      const task = await store.create({ text, priority });
      ctx.write('ok', `  ✔  added: "${task.text}" (${task.priority})`);
      return;
    }

    case 'done':
    case 'undo':
    case 'rm': {
      if (Number.isNaN(index)) {
        fail(`usage: ${cmd} N`);
        return;
      }
      const { tasks } = await store.list();
      const task = tasks[index - 1];
      if (!task) {
        fail(`no task #${index}`);
        return;
      }
      if (cmd === 'rm') {
        await store.remove(task.id);
        ctx.write('ok', `  ✔  removed: "${task.text}"`);
      } else {
        const done = cmd === 'done';
        await store.setStatus(task.id, done);
        ctx.write(done ? 'ok' : 'head', done ? `  ✔  completed: "${task.text}"` : `  ↩  reopened: "${task.text}"`);
      }
      return;
    }

    case 'edit': {
      if (Number.isNaN(index) || !text) {
        fail('usage: edit N "new text"');
        return;
      }
      const { tasks } = await store.list();
      const task = tasks[index - 1];
      if (!task) {
        fail(`no task #${index}`);
        return;
      }
      const updated = await store.update(task.id, { text });
      ctx.write('ok', `  ✔  updated: "${updated.text}"`);
      return;
    }

    case 'stats': {
      const s = await store.stats();
      ctx.write('', `  total: ${s.total}   done: ${s.done}   todo: ${s.todo}`);
      ctx.write('dim', `  by priority   high: ${s.byPriority.high}  med: ${s.byPriority.med}  low: ${s.byPriority.low}`);
      return;
    }

    case 'whoami':
      ctx.write('head', ctx.username ? `  signed in as: ${ctx.username}` : '  (local session, no account)');
      return;

    case 'clear':
      if (ctx.clear) ctx.clear();
      return;

    case 'exit':
    case 'quit':
      if (ctx.exit) ctx.exit();
      return;

    default:
      fail(`unknown command "${cmd}" — try help`);
  }
}
