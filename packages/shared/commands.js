/**
 * Command grammar shared by every surface: the CLI, the SSH TUI and the
 * browser terminal. This module is pure — it never touches the
 * filesystem or the network. Persistence is injected as `ctx.store`
 * (createFileStore/createPostgresStore for Node surfaces, a REST adapter
 * in the browser); output is injected as `ctx.write`.
 *
 * Commands: list [filters] | add TEXT [--high|--med|--low] [--due DATE] [--tag A,B]
 *           done N | undo N | rm N | edit N TEXT
 *           due N DATE | due N clear
 *           tag N a,b | untag N a | stats | whoami | help | clear | exit
 *
 * `parseCommand` is the ONE parser. The CLI, SSH server and browser all
 * route raw input through it, so the surfaces cannot drift.
 */

export const HELP_ENTRIES = [
  '  list [todo|done|--high|--med|--low|+tag|overdue]',
  '                                show tasks (optionally filtered)',
  '  add TEXT [--high|--med|--low] [--due DATE] [--tag a,b]',
  '                                create a task',
  '  done N                        mark task N done',
  '  undo N                        reopen task N',
  '  rm N                          delete task N',
  '  edit N TEXT                   retype task N',
  '  due N DATE|clear              set a due date (today, tomorrow, fri,',
  '                                2026-10-01, clear removes it)',
  '  tag N a,b                     add tags',
  '  untag N a                     remove a tag',
  '  stats                         counts by status, priority, overdue',
  '  whoami                        show the signed-in account',
  '  help                          this message',
];

/** Parse a command line into normalized pieces. The single parser. */
export function parseCommand(raw) {
  const parts = String(raw ?? '').trim().split(/\s+/).filter(Boolean);
  const cmd = (parts[0] ?? '').toLowerCase();
  const rest = parts.slice(1);
  const arg = rest.join(' ');

  let text = arg;
  let priority = 'med';
  let index = Number.NaN;
  let due;
  let tags;
  let filters = null;

  if (cmd === 'add') {
    text = arg
      .replace(/--(high|med|medium|low)\b/g, (_m, p) => {
        priority = p === 'medium' ? 'med' : p;
        return '';
      })
      .replace(/--due\s+(\S+)/i, (_m, value) => {
        due = value;
        return '';
      })
      .replace(/--tag\s+(\S+)/i, (_m, value) => {
        tags = value;
        return '';
      })
      .trim();
  } else if (cmd === 'edit') {
    index = Number.parseInt(rest[0], 10);
    text = rest.slice(1).join(' ').trim();
  } else if (cmd === 'done' || cmd === 'undo' || cmd === 'rm') {
    index = Number.parseInt(rest[0], 10);
  } else if (cmd === 'due') {
    index = Number.parseInt(rest[0], 10);
    text = rest.slice(1).join(' ').trim(); // date expression or "clear"
  } else if (cmd === 'tag' || cmd === 'untag') {
    index = Number.parseInt(rest[0], 10);
    text = rest.slice(1).join(' ').trim(); // comma-separated tag list
  } else if (cmd === 'list' || cmd === 'ls') {
    filters = { status: undefined, priority: undefined, tag: undefined, overdue: false };
    for (const token of rest) {
      if (token === 'todo' || token === 'done') filters.status = token;
      else if (token === '--high') filters.priority = 'high';
      else if (token === '--med' || token === '--medium') filters.priority = 'med';
      else if (token === '--low') filters.priority = 'low';
      else if (token === 'overdue') filters.overdue = true;
      else if (token.startsWith('#')) filters.tag = token.slice(1).toLowerCase();
      else if (token.startsWith('+')) filters.tag = token.slice(1).toLowerCase();
    }
  }

  return { cmd, arg, text, priority, index, due, tags, filters };
}

/** Parse a human due-date expression into an ISO timestamp (or null). */
export function parseDueDate(input) {
  const raw = String(input ?? '').trim().toLowerCase();
  if (!raw) return null;
  if (raw === 'clear' || raw === 'none' || raw === 'off') return null;

  const now = new Date();
  const at = (base, days, hour = 17) => {
    const d = new Date(base);
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  };

  if (raw === 'today') return at(now, 0);
  if (raw === 'tomorrow' || raw === 'tmr') return at(now, 1);
  if (raw === 'yesterday') return at(now, -1);

  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const dayMatch = weekdays.findIndex((d) => d.startsWith(raw) && raw.length >= 3);
  if (dayMatch !== -1) {
    const delta = (dayMatch - now.getDay() + 7) % 7 || 7; // always in the future
    return at(now, delta);
  }

  // ISO dates: 2026-10-01, 10-01 (this year), 2026/10/01, 10/01
  const iso = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), 17, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }
  const md = raw.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (md) {
    const d = new Date(now.getFullYear(), Number(md[1]) - 1, Number(md[2]), 17, 0, 0, 0);
    return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
  }

  return undefined; // unrecognized
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
  const { cmd, text, priority, index, due, tags, filters } = parseCommand(raw);
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
      // One fetch, filtered locally by the pure applyFilters. Numbers stay
      // canonical (positions in the full sorted list) so `done N` etc.
      // always match what a plain `list` shows.
      const { tasks: all } = await store.list();
      const visible = applyFilters(all, filters ?? { tag: undefined, overdue: false, status: undefined, priority: undefined });
      if (visible.length === 0) {
        const filtered = Boolean(filters?.tag || filters?.overdue || filters?.status || filters?.priority);
        ctx.write('warn', filtered ? '  ⚠  No tasks match this filter.' : '  ⚠  No tasks yet. Try: add "my first task"');
        return;
      }
      const doneCount = visible.filter((t) => t.status === 'done').length;
      for (const t of visible) {
        const isDone = t.status === 'done';
        const num = String(all.indexOf(t) + 1).padStart(2);
        const badge = isDone ? '✔' : '○';
        const pri = t.priority === 'high' ? '!!!' : t.priority === 'med' ? '!!' : '·';
        let line = `  ${num} ${badge} ${t.text} [${t.priority}] ${pri}`;
        if (t.tags?.length) line += ` #${t.tags.join(' #')}`;
        if (t.due) {
          const overdue = !isDone && new Date(t.due) < new Date();
          line += `  ${overdue ? '⚠' : '⏳'} ${formatDue(t.due)}`;
        }
        ctx.write(isDone ? 'done' : overdueClass(t), line);
      }
      const { pct, filled, empty } = progressBar(doneCount, visible.length);
      ctx.write('bar', `  ${'█'.repeat(filled)}${'░'.repeat(empty)} ${pct}% (${doneCount}/${visible.length} done)`);
      return;
    }

    case 'add': {
      if (!text) {
        fail('usage: add "task text" [--high|--med|--low] [--due DATE] [--tag a,b]');
        return;
      }
      let dueAt = null;
      if (due !== undefined) {
        dueAt = parseDueDate(due);
        if (dueAt === undefined) {
          fail(`cannot parse due date "${due}" — try today, tomorrow, fri or 2026-10-01`);
          return;
        }
      }
      const tagList = parseTags(tags);
      const task = await store.create({ text, priority, due: dueAt, tags: tagList });
      ctx.write('ok', `  ✔  added: "${task.text}" (${task.priority})${suffixFor(task)}`);
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
      if (!updated) {
        fail(`no task #${index}`);
        return;
      }
      ctx.write('ok', `  ✔  updated: "${updated.text}"`);
      return;
    }

    case 'due': {
      if (Number.isNaN(index)) {
        fail('usage: due N DATE   (today, tomorrow, fri, 2026-10-01 — or: due N clear)');
        return;
      }
      const { tasks } = await store.list();
      const task = tasks[index - 1];
      if (!task) {
        fail(`no task #${index}`);
        return;
      }
      let dueAt = null;
      if (text && text !== 'clear') {
        dueAt = parseDueDate(text);
        if (dueAt === undefined) {
          fail(`cannot parse due date "${text}" — try today, tomorrow, fri or 2026-10-01`);
          return;
        }
      }
      const updated = await store.update(task.id, { due: dueAt });
      ctx.write(
        'ok',
        updated.due
          ? `  ⏳  due ${formatDue(updated.due)}: "${updated.text}"`
          : `  ✔  due date cleared: "${updated.text}"`
      );
      return;
    }

    case 'tag': {
      if (Number.isNaN(index) || !parseTags(tags ?? text).length) {
        fail('usage: tag N a,b');
        return;
      }
      const { tasks } = await store.list();
      const task = tasks[index - 1];
      if (!task) {
        fail(`no task #${index}`);
        return;
      }
      const updated = await store.update(task.id, { tags: mergeTags(task.tags, parseTags(tags ?? text)) });
      ctx.write('ok', `  ✔  tagged: "${updated.text}" ${updated.tags.map((t) => `#${t}`).join(' ')}`);
      return;
    }

    case 'untag': {
      if (Number.isNaN(index) || !parseTags(tags ?? text).length) {
        fail('usage: untag N a');
        return;
      }
      const { tasks } = await store.list();
      const task = tasks[index - 1];
      if (!task) {
        fail(`no task #${index}`);
        return;
      }
      const remove = new Set(parseTags(tags ?? text));
      const updated = await store.update(task.id, { tags: (task.tags ?? []).filter((t) => !remove.has(t)) });
      ctx.write(
        'ok',
        updated.tags?.length
          ? `  ✔  tagged: "${updated.text}" ${updated.tags.map((t) => `#${t}`).join(' ')}`
          : `  ✔  tags cleared: "${updated.text}"`
      );
      return;
    }

    case 'stats': {
      const s = await store.stats();
      ctx.write('', `  total: ${s.total}   done: ${s.done}   todo: ${s.todo}`);
      ctx.write('dim', `  by priority   high: ${s.byPriority.high}  med: ${s.byPriority.med}  low: ${s.byPriority.low}`);
      if (s.overdue) ctx.write('warn', `  ⚠  overdue: ${s.overdue}`);
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

// --- line helpers (pure) -----------------------------------------------------

/**
 * The ONE task filter, in pure form so the browser can run it too.
 * Unknown filter values are ignored (the Node-side filterTasks in
 * store.js validates strictly for API callers).
 */
export function applyFilters(tasks, { status, priority, tag, overdue } = {}) {
  let visible = tasks;
  if (status === 'done' || status === 'todo') visible = visible.filter((t) => t.status === status);
  if (priority && ['high', 'med', 'low'].includes(priority)) visible = visible.filter((t) => t.priority === priority);
  if (tag) {
    const wanted = String(tag).toLowerCase();
    visible = visible.filter((t) => (t.tags ?? []).includes(wanted));
  }
  if (overdue) visible = visible.filter((t) => isOverdue(t));
  return visible;
}

function parseTags(input) {
  if (!input) return [];
  return String(input)
    .split(',')
    .map((t) => t.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
}

function mergeTags(existing = [], additions = []) {
  return [...new Set([...(existing ?? []), ...additions])].slice(0, 10);
}

function isOverdue(task) {
  return task.status !== 'done' && Boolean(task.due) && new Date(task.due) < new Date();
}

function overdueClass(task) {
  return isOverdue(task) ? 'warn' : '';
}

function formatDue(iso) {
  const d = new Date(iso);
  const today = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(d) - startOfDay(today)) / 86_400_000);
  const time = d.getHours() === 0 && d.getMinutes() === 0 ? '' : ` ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (days === 0) return `today${time}`;
  if (days === 1) return `tomorrow${time}`;
  if (days === -1) return `yesterday${time}`;
  const date = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return days < 0 ? `${date} (${Math.abs(days)}d ago)` : `${date} (+${days}d)`;
}

function suffixFor(task) {
  let suffix = '';
  if (task.tags?.length) suffix += ` #${task.tags.join(' #')}`;
  if (task.due) suffix += `  ⏳ ${formatDue(task.due)}`;
  return suffix;
}
