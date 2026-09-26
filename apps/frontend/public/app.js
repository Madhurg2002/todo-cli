/**
 * Web terminal client.
 *
 * Command grammar comes from the shared module (@todo/shared/commands,
 * served verbatim at /vendor/shared-commands.js) so the browser, the SSH
 * TUI and the CLI all speak the same language. This file only provides:
 *   - a REST-backed store adapter (ctx.store)
 *   - a DOM io sink (ctx.write / ctx.clear)
 *   - the account gate (register / login / logout)
 */
import { runCommand } from '/vendor/shared-commands.js';

const $ = (id) => document.getElementById(id);

const authEl = $('auth');
const authForm = $('auth-form');
const authErr = $('auth-err');
const authSubmit = $('auth-submit');
const authSwitch = $('auth-switch');
const authAlt = $('auth-alt');

const crt = $('crt');
const landing = $('landing');
const output = $('output');
const screen = $('screen');
const form = $('prompt');
const input = $('input');
const conn = $('conn');
const userEl = $('user');
const logoutBtn = $('logout');

let mode = 'login';
let me = null;

// --- REST-backed store adapter --------------------------------------------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(opts.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 401) {
    showAuth('session expired — sign in again');
    throw new Error('unauthorized');
  }
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

const store = {
  async list() {
    return api('/api/tasks');
  },
  async create({ text, priority }) {
    const { task } = await api('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ text, priority }),
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

// --- DOM io sink -----------------------------------------------------------

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

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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

// --- account gate ----------------------------------------------------------

function showAuth(message = '') {
  authEl.hidden = false;
  crt.hidden = true;
  landing.hidden = true;
  authErr.hidden = !message;
  authErr.textContent = message;
  $('auth-user').focus();
}

function showApp(user) {
  me = user;
  authEl.hidden = true;
  crt.hidden = false;
  landing.hidden = false;
  userEl.textContent = ` ${user.username} `;
  input.focus();
  boot();
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

// --- terminal wiring -------------------------------------------------------

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = input.value;
  input.value = '';
  echoCommand(raw);
  if (!raw.trim()) return;
  try {
    await runCommand(raw, ctx);
  } catch (err) {
    paint('err', `  ✗  ${err.message}`);
  }
  screen.scrollTop = screen.scrollHeight;
});

document.querySelectorAll('.hints span').forEach((hint) => {
  hint.addEventListener('click', () => {
    input.value = hint.textContent;
    input.focus();
  });
});

async function boot() {
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
  paint('dim', '  type "help" for commands.');
  paint('', '');
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

// --- start -----------------------------------------------------------------

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
