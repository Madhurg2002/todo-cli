/**
 * todo.sh web client — dual view.
 *
 * Two views over the same REST API and the same SSE change feed:
 *   - BOARD: a GUI (quick-add, click-to-complete, inline edit, filters)
 *   - TERMINAL: the CRT web terminal speaking the shared grammar
 *
 * The terminal's command grammar comes from the shared module
 * (@todo/shared/commands, served verbatim at /vendor/shared-commands.js)
 * so the browser, the SSH TUI and the CLI all speak the same language.
 * This file provides:
 *   - a REST-backed store adapter (ctx.store) for the shared grammar
 *   - DOM io sinks for both views
 *   - the account gate (register / login / logout)
 *   - live sync via the SSE change feed (board AND terminal re-render)
 *   - a settings panel (password, sessions, account deletion)
 */
import { runCommand, parseDueDate } from '/vendor/shared-commands.js';

const $ = (id) => document.getElementById(id);

// --- dom handles -------------------------------------------------------------

const authEl = $('auth');
const authForm = $('auth-form');
const authErr = $('auth-err');
const authSubmit = $('auth-submit');
const authSwitch = $('auth-switch');
const authAlt = $('auth-alt');

const appEl = $('app');
const boardEl = $('board');
const crt = $('crt');
const output = $('output');
const screen = $('screen');
const form = $('prompt');
const input = $('input');
const conn = $('conn');
const userEl = $('user');
const logoutBtn = $('logout');

const settingsEl = $('settings');
const sessionsEl = $('sessions');

let mode = 'login';
let me = null;
let view = localStorage.getItem('todo.view') === 'terminal' ? 'terminal' : 'board';
let tasks = [];
let stats = null;
let filter = localStorage.getItem('todo.filter') || 'all';
let editingId = null;

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// --- REST helpers ------------------------------------------------------------

function handle401() {
  stopEvents();
  showAuth('session expired — sign in again');
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
  });
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    handle401();
    throw new Error('unauthorized');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

// --- REST-backed store adapter (powers the web terminal) ---------------------

const store = {
  async list() {
    return api('/api/tasks');
  },
  async create({ text, priority, due, tags }) {
    const { task } = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ text, priority, due, tags }),
    });
    return task;
  },
  async update(id, patch) {
    const { task } = await api(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    });
    return task;
  },
  async setStatus(id, done) {
    const { task } = await api(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: done ? 'done' : 'todo' }),
    });
    return task;
  },
  async remove(id) {
    await api(`/api/tasks/${id}`, { method: 'DELETE' });
  },
  async stats() {
    return api('/api/stats');
  },
};

// ============================================================================
// BOARD VIEW (GUI)
// ============================================================================

const FILTERS = [
  { id: 'all', label: 'all' },
  { id: 'todo', label: 'open' },
  { id: 'done', label: 'done' },
  { id: 'overdue', label: 'overdue' },
];

function dueInfo(task) {
  if (!task.due) return null;
  const d = new Date(task.due);
  const today = new Date();
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(d) - startOfDay(today)) / 86_400_000);
  const overdue = task.status !== 'done' && d < today;
  let label;
  if (days === 0) label = 'today';
  else if (days === 1) label = 'tomorrow';
  else if (days === -1) label = 'yesterday';
  else if (days < 0) label = `${-days}d overdue`;
  else if (days <= 7) label = d.toLocaleDateString(undefined, { weekday: 'short' });
  else label = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return { label, overdue };
}

function visibleTasks() {
  const now = new Date();
  switch (filter) {
    case 'todo':
      return tasks.filter((t) => t.status === 'todo');
    case 'done':
      return tasks.filter((t) => t.status === 'done');
    case 'overdue':
      return tasks.filter((t) => t.status !== 'done' && t.due && new Date(t.due) < now);
    default:
      return tasks;
  }
}

function renderBoard() {
  // filter chips (recomputed so tag chips follow the data)
  const tags = [...new Set(tasks.flatMap((t) => t.tags ?? []))].sort();
  const chips = $('filter-chips');
  chips.innerHTML =
    FILTERS.map(
      (f) => `<button class="chip ${filter === f.id ? 'active' : ''}" data-filter="${f.id}">${f.label}</button>`
    ).join('') +
    tags
      .map(
        (t) =>
          `<button class="chip tag ${filter === `#${t}` ? 'active' : ''}" data-filter="#${esc(t)}">#${esc(t)}</button>`
      )
      .join('');

  // stats strip
  if (stats) {
    const p = stats.byPriority ?? { high: 0, med: 0, low: 0 };
    $('stats-strip').innerHTML =
      `<span><b>${stats.total}</b> total</span>` +
      `<span><b>${stats.todo}</b> open</span>` +
      `<span><b>${stats.done}</b> done</span>` +
      (stats.overdue ? `<span class="overdue-stat"><b>${stats.overdue}</b> overdue</span>` : '') +
      `<span class="pri-stat p-high"><b>${p.high}</b> high</span>` +
      `<span class="pri-stat p-med"><b>${p.med}</b> med</span>` +
      `<span class="pri-stat p-low"><b>${p.low}</b> low</span>` +
      `<span class="pct-wrap"><span class="mini-bar"><span style="width:${stats.percentDone}%"></span></span><b>${stats.percentDone}%</b></span>`;
  }

  // task rows
  const list = $('task-list');
  const visible = visibleTasks();
  const all = tasks; // canonical order for numbering
  if (visible.length === 0) {
    list.innerHTML =
      `<div class="empty">` +
      (tasks.length === 0
        ? 'Nothing here yet.<br><span class="dim-text">Add your first task above — or type <code>add "…"</code> in the terminal.</span>'
        : 'No tasks match this filter.') +
      `</div>`;
    return;
  }
  list.innerHTML = visible
    .map((t) => {
      const num = String(all.indexOf(t) + 1).padStart(2, '0');
      const done = t.status === 'done';
      const due = dueInfo(t);
      const isEditing = editingId === t.id;
      if (isEditing) {
        const dateVal = t.due ? t.due.slice(0, 10) : '';
        return (
          `<li class="task editing" data-id="${t.id}">` +
          `<span class="num">${num}</span>` +
          `<div class="edit-form">` +
          `<input class="edit-text" value="${esc(t.text)}" />` +
          `<div class="edit-row">` +
          `<select class="edit-pri">` +
          `  <option value="high" ${t.priority === 'high' ? 'selected' : ''}>high</option>` +
          `  <option value="med" ${t.priority === 'med' ? 'selected' : ''}>med</option>` +
          `  <option value="low" ${t.priority === 'low' ? 'selected' : ''}>low</option>` +
          `</select>` +
          `<input type="date" class="edit-due" value="${dateVal}" />` +
          `<input class="edit-tags" value="${esc((t.tags ?? []).join(', '))}" placeholder="tags, comma-sep" />` +
          `</div>` +
          `<div class="edit-row">` +
          `<button class="save-btn">save</button>` +
          `<button class="cancel-btn">cancel</button>` +
          `</div>` +
          `</div>` +
          `</li>`
        );
      }
      return (
        `<li class="task ${done ? 'is-done' : ''} ${due?.overdue ? 'is-overdue' : ''}" data-id="${t.id}">` +
        `<span class="num">${num}</span>` +
        `<button class="toggle" title="${done ? 'reopen' : 'complete'}">${done ? '✔' : ''}</button>` +
        `<span class="text">${esc(t.text)}</span>` +
        `<span class="pri pri-${t.priority}">${t.priority}</span>` +
        (t.tags ?? [])
          .map((tag) => `<button class="tag-badge" data-tag="${esc(tag)}">#${esc(tag)}</button>`)
          .join('') +
        (due ? `<span class="due ${due.overdue ? 'late' : ''}">⏳ ${esc(due.label)}</span>` : '') +
        `<span class="actions">` +
        `<button class="edit-btn" title="edit">✎</button>` +
        `<button class="del-btn" title="delete">✕</button>` +
        `</span>` +
        `</li>`
      );
    })
    .join('');
}

async function refreshBoard() {
  try {
    const [listBody, statsBody] = await Promise.all([api('/api/tasks'), api('/api/stats')]);
    tasks = listBody.tasks;
    stats = statsBody;
    renderBoard();
  } catch {
    /* offline; the health badge already says so */
  }
}

// board events (delegated)
$('task-list').addEventListener('click', async (e) => {
  const row = e.target.closest('.task');
  if (!row || row.classList.contains('editing')) return;
  const id = row.dataset.id;
  const task = tasks.find((t) => t.id === id);
  if (!task) return;

  if (e.target.closest('.toggle')) {
    await api(`/api/tasks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: task.status === 'done' ? 'todo' : 'done' }),
    }).catch(() => {});
    return; // SSE re-renders
  }
  if (e.target.closest('.del-btn')) {
    await api(`/api/tasks/${id}`, { method: 'DELETE' }).catch(() => {});
    return;
  }
  if (e.target.closest('.edit-btn')) {
    editingId = id;
    renderBoard();
    row.querySelector('.edit-text')?.focus();
    return;
  }
  if (e.target.closest('.tag-badge')) {
    filter = `#${e.target.closest('.tag-badge').dataset.tag}`;
    localStorage.setItem('todo.filter', filter);
    renderBoard();
  }
});

$('task-list').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !e.target.classList.contains('edit-text')) return;
  e.preventDefault();
  $('task-list').querySelector('.save-btn')?.click();
});

$('task-list').addEventListener('submit', () => {}); // no-op guard

document.addEventListener('click', async (e) => {
  if (!editingId) return;
  if (e.target.closest('.cancel-btn')) {
    editingId = null;
    renderBoard();
    return;
  }
  if (!e.target.closest('.save-btn')) return;
  const row = $('task-list').querySelector('.task.editing');
  if (!row) return;
  const id = row.dataset.id;
  const text = row.querySelector('.edit-text').value.trim();
  if (!text) return;
  const dateVal = row.querySelector('.edit-due').value;
  const due = dateVal ? new Date(`${dateVal}T17:00:00`).toISOString() : null;
  const tags = row
    .querySelector('.edit-tags')
    .value.split(',')
    .map((t) => t.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean);
  editingId = null;
  await api(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ text, priority: row.querySelector('.edit-pri').value, due, tags }),
  }).catch(() => {});
});

$('filter-chips').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  filter = chip.dataset.filter;
  localStorage.setItem('todo.filter', filter);
  renderBoard();
});

$('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const textEl = $('quick-text');
  const text = textEl.value.trim();
  if (!text) return;
  const priority = $('quick-pri').value;
  const dateVal = $('quick-due').value;
  const due = dateVal ? new Date(`${dateVal}T17:00:00`).toISOString() : null;
  const tags = $('quick-tags')
    .value.split(',')
    .map((t) => t.trim().replace(/^#/, '').toLowerCase())
    .filter(Boolean);
  textEl.value = '';
  $('quick-tags').value = '';
  await api('/api/tasks', {
    method: 'POST',
    body: JSON.stringify({ text, priority, due, tags }),
  }).catch((err) => {
    const box = $('add-err');
    box.textContent = err.message;
    box.hidden = false;
    setTimeout(() => (box.hidden = true), 4000);
  });
});

// ============================================================================
// TERMINAL VIEW (web CRT)
// ============================================================================

function paint(cls, text) {
  const el = document.createElement('span');
  el.className = `line ${cls ?? ''}`;
  el.textContent = text;
  output.appendChild(el);
}

function write(cls, text) {
  if (cls === 'bar') {
    const m = text.match(/(?<bar>[█░]+)\s(?<pct>\d+)%(?<tail>.*)$/);
    if (m) {
      const { bar, pct, tail } = m.groups;
      const filled = (bar.match(/█/g) ?? []).length;
      const empty = (bar.match(/░/g) ?? []).length;
      const el = document.createElement('span');
      el.className = 'line bar';
      el.innerHTML =
        `  <span class="bar">${'█'.repeat(filled)}<span class="track">${'░'.repeat(empty)}</span></span>` +
        ` <span class="pct">${esc(pct)}%</span><span class="dim">${esc(tail)}</span>`;
      output.appendChild(el);
      return;
    }
  }
  paint(cls, text);
}

function echoCommand(raw) {
  const el = document.createElement('span');
  el.className = 'line cmd';
  el.innerHTML = `<span class="ps1">todo&gt;</span> ${esc(raw)}`;
  output.appendChild(el);
}

const ctx = {
  store,
  get username() {
    return me?.username;
  },
  write,
  clear() {
    output.innerHTML = '';
  },
  exit() {},
};

let history = [];
let historyPos = -1;

async function bootTerminal() {
  paint('head', '  ╔══════════════════════════════════════╗');
  paint('head', '  ║   TODO — web terminal                ║');
  paint('head', '  ╚══════════════════════════════════════╝');
  paint('', '');
  try {
    await runCommand('list', ctx);
  } catch (err) {
    paint('err', `  ✗  ${err.message}`);
  }
  paint('', '');
  paint('dim', '  type "help" for commands — due dates and tags work here too:');
  paint('dim', '  add "ship" --high --due fri --tag dev   ·   due 2 tomorrow   ·   list +dev');
  paint('', '');
  screen.scrollTop = screen.scrollHeight;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = input.value;
  input.value = '';
  echoCommand(raw);
  if (raw.trim()) {
    if (history[history.length - 1] !== raw) history.push(raw);
    historyPos = history.length;
  }
  if (!raw.trim()) return;
  try {
    await runCommand(raw, ctx);
  } catch (err) {
    paint('err', `  ✗  ${err.message}`);
  }
  screen.scrollTop = screen.scrollHeight;
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (history.length === 0) return;
    historyPos = Math.max(0, historyPos - 1);
    input.value = history[historyPos] ?? '';
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    historyPos = Math.min(history.length, historyPos + 1);
    input.value = history[historyPos] ?? '';
  } else if (e.key === 'l' && e.ctrlKey) {
    e.preventDefault();
    ctx.clear();
  } else if (e.key === 'Tab') {
    e.preventDefault();
    const value = input.value;
    const commands = ['add', 'list', 'done', 'undo', 'rm', 'edit', 'due', 'tag', 'untag', 'stats', 'whoami', 'help', 'clear'];
    const matches = commands.filter((c) => c.startsWith(value) && value);
    if (matches.length === 1) input.value = matches[0] + ' ';
  }
});

document.querySelectorAll('.hints span').forEach((hint) => {
  hint.addEventListener('click', () => {
    switchView('terminal');
    input.value = hint.textContent;
    input.focus();
  });
});

// ============================================================================
// VIEW SWITCHING + LIVE SYNC (both views)
// ============================================================================

function switchView(next) {
  view = next;
  localStorage.setItem('todo.view', next);
  boardEl.hidden = view !== 'board';
  crt.hidden = view !== 'terminal';
  document.querySelectorAll('.view-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === view);
  });
  if (view === 'terminal') input.focus();
  else refreshBoard();
}

document.querySelectorAll('.view-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchView(btn.dataset.view));
});

let evtSource = null;

function startEvents() {
  if (evtSource) return;
  evtSource = new EventSource('/api/events');
  evtSource.addEventListener('change', () => {
    conn.textContent = '● live';
    syncViews();
  });
  evtSource.onopen = () => {
    conn.textContent = '● live';
    conn.classList.remove('down');
  };
  evtSource.onerror = () => {
    conn.textContent = '● offline';
    conn.classList.add('down');
  };
}

function stopEvents() {
  if (evtSource) {
    evtSource.close();
    evtSource = null;
  }
}

/** One change feed → both views. Board re-renders; terminal re-lists. */
function syncViews() {
  refreshBoard();
  if (view === 'terminal') refreshTerminalView();
}

/**
 * Rerender the terminal's task view after an SSE change from another
 * surface. Rebuilds the output from a fresh `list` + `stats` run through
 * the shared grammar so every tab shows the same state.
 */
let currentRenderedTasks = null;
async function refreshTerminalView() {
  const lines = [];
  const sink = {
    store,
    username: me?.username,
    write(cls, text) {
      lines.push({ cls, text });
    },
  };
  try {
    await runCommand('list', sink);
    await runCommand('stats', sink);
  } catch {
    return; // offline; the health badge already says so
  }
  const snapshot = JSON.stringify(lines);
  if (snapshot === currentRenderedTasks) return; // nothing changed for me
  currentRenderedTasks = snapshot;

  output.innerHTML = '';
  for (const { cls, text } of lines) write(cls, text);
  paint('dim', '  (synced from another session)');
  paint('', '');
  paint('dim', '  type "help" for commands.');
  screen.scrollTop = screen.scrollHeight;
}

async function ping() {
  try {
    const res = await fetch('/api/health');
    if (!res.ok) throw new Error('down');
    conn.textContent = '● live';
    conn.classList.remove('down');
  } catch {
    conn.textContent = '● offline';
    conn.classList.add('down');
  }
}

// ============================================================================
// ACCOUNT GATE + SETTINGS
// ============================================================================

function showAuth(message = '') {
  stopEvents();
  authEl.hidden = false;
  appEl.hidden = true;
  settingsEl.hidden = true;
  authErr.hidden = !message;
  authErr.textContent = message;
  $('auth-user').focus();
}

function showApp(user) {
  me = user;
  authEl.hidden = true;
  appEl.hidden = false;
  settingsEl.hidden = true;
  userEl.textContent = ` ${user.username} `;
  switchView(view);
  startEvents();
  ping();
}

authSwitch.addEventListener('click', (e) => {
  e.preventDefault();
  mode = mode === 'login' ? 'register' : 'login';
  authSubmit.textContent = mode === 'login' ? 'sign in' : 'create account';
  authAlt.innerHTML =
    mode === 'login'
      ? 'no account? <a href="#" id="auth-switch">create one</a>'
      : 'have an account? <a href="#" id="auth-switch">sign in</a>';
  authErr.hidden = true;
  $('auth-switch').addEventListener('click', authSwitch.onclick);
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  authErr.hidden = true;
  authSubmit.disabled = true;
  try {
    const { user } = await api(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify({
        username: $('auth-user').value.trim(),
        password: $('auth-pass').value,
      }),
    });
    $('auth-pass').value = '';
    showApp(user);
  } catch (err) {
    authErr.hidden = false;
    authErr.textContent = err.message;
  } finally {
    authSubmit.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  me = null;
  output.innerHTML = '';
  showAuth('signed out');
});

function openSettings() {
  settingsEl.hidden = false;
  loadSessions();
}

function closeSettings() {
  settingsEl.hidden = true;
  if (view === 'terminal') input.focus();
}

$('settings-btn').addEventListener('click', openSettings);
$('settings-close').addEventListener('click', closeSettings);
settingsEl.addEventListener('click', (e) => {
  if (e.target === settingsEl) closeSettings();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !settingsEl.hidden) closeSettings();
});

$('pw-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('pw-msg');
  msg.textContent = '';
  msg.className = 'form-msg';
  try {
    await api('/api/auth/password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: $('pw-current').value,
        newPassword: $('pw-new').value,
      }),
    });
    msg.textContent = 'password updated — other devices were signed out.';
    msg.classList.add('good');
    $('pw-current').value = '';
    $('pw-new').value = '';
    loadSessions();
  } catch (err) {
    msg.textContent = err.message;
    msg.classList.add('bad');
  }
});

$('del-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('del-msg');
  msg.textContent = '';
  msg.className = 'form-msg';
  try {
    await api('/api/auth/account', {
      method: 'DELETE',
      body: JSON.stringify({ password: $('del-pass').value }),
    });
    me = null;
    output.innerHTML = '';
    showAuth('account deleted. goodbye.');
  } catch (err) {
    msg.textContent = err.message;
    msg.classList.add('bad');
  }
});

async function loadSessions() {
  sessionsEl.innerHTML = '<li class="dim-text">loading…</li>';
  try {
    const { sessions } = await api('/api/auth/sessions');
    sessionsEl.innerHTML = '';
    if (sessions.length === 0) {
      sessionsEl.innerHTML = '<li class="dim-text">no other active sessions</li>';
      return;
    }
    for (const s of sessions) {
      const li = document.createElement('li');
      const created = new Date(s.createdAt).toLocaleString();
      const expires = new Date(s.expiresAt).toLocaleDateString();
      li.innerHTML =
        `<span class="sess-id">${esc(s.id)}</span>` +
        `<span class="sess-meta">started ${esc(created)} · expires ${esc(expires)}</span>` +
        (s.current
          ? '<span class="sess-now">this device</span>'
          : '<button class="revoke" data-id="' + esc(s.id) + '">sign out</button>');
      sessionsEl.appendChild(li);
    }
    sessionsEl.querySelectorAll('.revoke').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(`/api/auth/sessions/${btn.dataset.id}`, { method: 'DELETE' }).catch(() => {});
        loadSessions();
      });
    });
  } catch (err) {
    sessionsEl.innerHTML = `<li class="dim-text">${esc(err.message)}</li>`;
  }
}

// --- start -------------------------------------------------------------------

(async () => {
  ping();
  setInterval(ping, 10000);
  try {
    const { user } = await api('/api/auth/me');
    showApp(user);
  } catch {
    showAuth();
  }
})();
