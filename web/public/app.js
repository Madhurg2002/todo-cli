/**
 * Web terminal client. Talks to the same REST API the CLI and SSH
 * sessions share. Commands mirror the SSH TUI one-for-one.
 */
const output = document.getElementById('output');
const screen = document.getElementById('screen');
const form = document.getElementById('prompt');
const input = document.getElementById('input');
const conn = document.getElementById('conn');

const HELP = [
  ['head', 'Commands'],
  ['dim', '  list                show all tasks with progress'],
  ['dim', '  add TEXT [--high|--med|--low]   create a task'],
  ['dim', '  done N              mark task N done'],
  ['dim', '  undo N              reopen task N'],
  ['dim', '  rm N                delete task N'],
  ['dim', '  stats               counts by status and priority'],
  ['dim', '  clear               clear the screen'],
  ['dim', '  help                this message'],
];

function line(cls, text) {
  const el = document.createElement('span');
  el.className = `line ${cls ?? ''}`;
  el.textContent = text;
  output.appendChild(el);
}

function html(cls, markup) {
  const el = document.createElement('span');
  el.className = `line ${cls ?? ''}`;
  el.innerHTML = markup;
  output.appendChild(el);
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const pri = (p) => `<span class="pri-${p}">${'!'.repeat(p === 'high' ? 3 : p === 'med' ? 2 : 1)}</span>`;

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

async function renderTable() {
  const { tasks } = await api('/api/tasks');
  if (tasks.length === 0) {
    line('warn', '⚠  No tasks yet. Try: add "my first task"');
    return;
  }
  const doneCount = tasks.filter((t) => t.status === 'done').length;
  const pct = Math.round((doneCount / tasks.length) * 100);
  tasks.forEach((t, i) => {
    const num = String(i + 1).padStart(2);
    const badge = t.status === 'done' ? '✔' : '○';
    const cls = t.status === 'done' ? 'done' : '';
    html('', `  <span class="dim">${num}</span> ${badge} <span class="${cls}">${esc(t.text)}</span> <span class="dim">[${esc(t.priority)}]</span> ${pri(t.priority)}`);
  });
  html('', '');
  const filled = Math.round(pct / 5);
  html('', `  <span class="bar">${'█'.repeat(filled)}<span class="track">${'░'.repeat(20 - filled)}</span></span> <span class="pct">${pct}%</span> <span class="dim">(${doneCount}/${tasks.length} done)</span>`);
}

async function renderStats() {
  const s = await api('/api/stats');
  html('', '');
  html('', `  <span>total</span>: ${s.total}   <span class="ok">done</span>: ${s.done}   <span class="head">todo</span>: ${s.todo}`);
  html('', `  <span class="dim">by priority</span>   <span class="pri-high">high</span>: ${s.byPriority.high}  <span class="pri-med">med</span>: ${s.byPriority.med}  <span class="pri-low">low</span>: ${s.byPriority.low}`);
  html('', '');
}

async function run(raw) {
  const [cmd, ...rest] = raw.trim().split(/\s+/);
  const arg = rest.join(' ');

  switch (cmd) {
    case 'help':
    case '?':
      HELP.forEach(([cls, text]) => line(cls, text));
      return;
    case 'clear':
      output.innerHTML = '';
      return;
    case 'list':
    case 'ls':
      await renderTable();
      return;
    case 'stats':
      await renderStats();
      return;
    case 'add': {
      if (!arg) throw new Error('usage: add "task text" [--high|--med|--low]');
      let priority = 'med';
      const text = arg
        .replace(/--(high|med|medium|low)\b/g, (_m, p) => { priority = p === 'medium' ? 'med' : p; return ''; })
        .trim();
      if (!text) throw new Error('task text cannot be empty');
      const { task } = await api('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text, priority }),
      });
      html('ok', `  ✔  added: <b>"${esc(task.text)}"</b> <span class="dim">(${task.priority})</span>`);
      return;
    }
    case 'done':
    case 'undo':
    case 'rm': {
      const n = parseInt(rest[0], 10);
      if (Number.isNaN(n)) throw new Error(`usage: ${cmd} N`);
      const { tasks } = await api('/api/tasks');
      const task = tasks[n - 1];
      if (!task) throw new Error(`no task #${n}`);
      if (cmd === 'rm') {
        await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
        html('ok', `  ✔  removed: <s class="dim">"${esc(task.text)}"</s>`);
      } else {
        const status = cmd === 'done' ? 'done' : 'todo';
        await api(`/api/tasks/${task.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status }),
        });
        if (status === 'done') html('ok', `  ✔  completed: <s class="dim">"${esc(task.text)}"</s>`);
        else html('head', `  ↩  reopened: <b>"${esc(task.text)}"</b>`);
      }
      return;
    }
    default:
      throw new Error(`unknown command "${cmd}" — try help`);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = input.value;
  input.value = '';
  html('cmd', `<span class="ps1">todo&gt;</span> ${esc(raw)}`);
  if (!raw.trim()) return;
  try {
    await run(raw);
  } catch (err) {
    line('err', `  ✗  ${err.message}`);
  }
  screen.scrollTop = screen.scrollHeight;
});

document.querySelectorAll('.hints span').forEach((hint) => {
  hint.addEventListener('click', () => {
    input.value = hint.textContent;
    input.focus();
  });
});

// health badge
async function ping() {
  try {
    await api('/api/health');
    conn.textContent = '● live';
    conn.classList.remove('down');
  } catch {
    conn.textContent = '● offline';
    conn.classList.add('down');
  }
}
ping();
setInterval(ping, 10000);

// boot sequence
(async () => {
  line('head', '  ╔══════════════════════════════════════╗');
  line('head', '  ║   TODO — web terminal                ║');
  line('head', '  ╚══════════════════════════════════════╝');
  html('', '');
  try {
    await renderTable();
  } catch (err) {
    line('err', `  ✗  ${err.message}`);
  }
  html('', '');
  line('dim', '  type "help" for commands.');
  html('', '');
})();
