import { loadTasks, saveTasks, addTask, setTaskStatus, removeTask, PRIORITIES, StoreError } from './store.js';

/**
 * Command grammar shared by the SSH TUI and the web terminal so every
 * surface parses and executes task operations identically.
 *
 * run() is I/O-agnostic: the caller supplies an output sink and the
 * store, so the SSH stream and the browser DOM behave the same.
 *
 * Commands: list | add TEXT [--high|--med|--low] | done N | undo N |
 *           rm N | stats | help | clear
 */

export const HELP_ENTRIES = [
  '  list                show all tasks with progress',
  '  add TEXT [--high|--med|--low]   create a task',
  '  done N              mark task N done',
  '  undo N              reopen task N',
  '  rm N                delete task N',
  '  stats               counts by status and priority',
  '  help                this message',
];

/** Parse "add buy milk --high" → { cmd, text, priority, index } pieces. */
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

  return { cmd, arg, text, priority, index: Number.parseInt(rest[0], 10) };
}

/** Build the ASCII progress bar shared by terminal renderers. */
export function progressBar(done, total, { width = 20 } = {}) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  const filled = Math.min(width, Math.round(pct / (100 / width)));
  return { pct, filled, empty: width - filled };
}

/**
 * Execute a command against the store.
 * @param {string} raw user input line
 * @param {object} io output sink
 * @param {(cls: string, text: string) => void} io.write emit a line
 * @param {() => void} [io.clear] clear the screen
 * @param {() => void} [io.exit] end the session
 * @param {{loadTasks?: Function, saveTasks?: Function}} [deps] store overrides (tests)
 */
export async function runCommand(raw, io, deps = {}) {
  const load = deps.loadTasks ?? loadTasks;
  const save = deps.saveTasks ?? saveTasks;
  const { cmd, text, priority, index } = parseCommand(raw);

  const fail = (msg) => io.write('err', `  ✗  ${msg}`);
  const storeOps = async (fn) => {
    try {
      const tasks = load();
      const result = fn(tasks);
      if (result?.mutated) save(tasks);
      return result;
    } catch (err) {
      if (err instanceof StoreError) fail(err.message);
      else fail(err.message);
      return null;
    }
  };

  switch (cmd) {
    case '':
      return;

    case 'help':
    case '?':
      io.write('head', 'Commands');
      HELP_ENTRIES.forEach((entry) => io.write('dim', entry));
      return;

    case 'list':
    case 'ls': {
      const res = await storeOps((tasks) => ({ tasks }));
      if (!res) return;
      const { tasks } = res;
      if (tasks.length === 0) {
        io.write('warn', '  ⚠  No tasks yet. Try: add "my first task"');
        return;
      }
      const doneCount = tasks.filter((t) => t.status === 'done').length;
      tasks.forEach((t, i) => {
        const isDone = t.status === 'done';
        const num = String(i + 1).padStart(2);
        const badge = isDone ? '✔' : '○';
        const pri = t.priority === 'high' ? '!!!' : t.priority === 'med' ? '!!' : '·';
        io.write(isDone ? 'done' : '', `  ${num} ${badge} ${t.text} [${t.priority}] ${pri}`);
      });
      const { pct, filled, empty } = progressBar(doneCount, tasks.length);
      io.write('bar', `  ${'█'.repeat(filled)}${'░'.repeat(empty)} ${pct}% (${doneCount}/${tasks.length} done)`);
      return;
    }

    case 'add': {
      if (!text) {
        fail('usage: add "task text" [--high|--med|--low]');
        return;
      }
      if (!PRIORITIES.includes(priority)) {
        fail(`priority must be one of: ${PRIORITIES.join(', ')}`);
        return;
      }
      await storeOps((tasks) => {
        const task = addTask(tasks, { text, priority });
        save(tasks);
        io.write('ok', `  ✔  added: "${task.text}" (${task.priority})`);
        return { mutated: false };
      });
      return;
    }

    case 'done':
    case 'undo':
    case 'rm': {
      if (Number.isNaN(index)) {
        fail(`usage: ${cmd} N`);
        return;
      }
      await storeOps((tasks) => {
        const task = tasks[index - 1];
        if (!task) {
          fail(`no task #${index}`);
          return { mutated: false };
        }
        if (cmd === 'rm') {
          removeTask(tasks, task.id);
          save(tasks);
          io.write('ok', `  ✔  removed: "${task.text}"`);
        } else {
          setTaskStatus(tasks, task.id, cmd === 'done');
          save(tasks);
          io.write(cmd === 'done' ? 'ok' : 'head', cmd === 'done' ? `  ✔  completed: "${task.text}"` : `  ↩  reopened: "${task.text}"`);
        }
        return { mutated: false };
      });
      return;
    }

    case 'stats': {
      const res = await storeOps((tasks) => ({ tasks }));
      if (!res) return;
      const { tasks } = res;
      const done = tasks.filter((t) => t.status === 'done').length;
      const byPri = { high: 0, med: 0, low: 0 };
      for (const t of tasks) byPri[t.priority] += 1;
      io.write('', `  total: ${tasks.length}   done: ${done}   todo: ${tasks.length - done}`);
      io.write('dim', `  by priority   high: ${byPri.high}  med: ${byPri.med}  low: ${byPri.low}`);
      return;
    }

    case 'clear':
      if (io.clear) io.clear();
      return;

    case 'exit':
    case 'quit':
      if (io.exit) io.exit();
      return;

    default:
      fail(`unknown command "${cmd}" — try help`);
  }
}
