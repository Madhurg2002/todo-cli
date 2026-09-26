/**
 * Web terminal client. Command parsing/execution comes from the shared
 * grammar (@todo/shared/commands, served as a browser bundle), so the
 * browser, SSH and CLI all speak the exact same language. This file
 * only supplies the browser io sink and API-backed store access.
 */
import { runCommand } from '/vendor/shared-commands.js';

const output = document.getElementById('output');
const screen = document.getElementById('screen');
const form = document.getElementById('prompt');
const input = document.getElementById('input');
const conn = document.getElementById('conn');

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

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${res.status} ${res.statusText}`);
  return body;
}

/** Browser io sink: paints shared-grammar lines into the DOM. */
const io = {
  write(cls, text) {
    if (cls === 'bar') {
      const m = text.match(/^(?<bar>\s*[█░]+)\s(?<pct>\d+)%/);
      if (m) {
        const { bar, pct } = m.groups;
        const filled = (bar.match(/█/g) ?? []).length;
        const empty = (bar.match(/░/g) ?? []).length;
        const tail = text.slice(m.index + m[0].length);
        html('bar', `${esc(m.groups.bar.slice(0, 2))}<span class="bar">${'█'.repeat(filled)}<span class="track">${'░'.repeat(empty)}</span></span> <span class="pct">${esc(pct)}%</span><span class="dim">${esc(tail)}</span>`);
        return;
      }
    }
    line(cls, text);
  },
  clear() {
    output.innerHTML = '';
  },
  exit() {},
};

async function refresh() {
  try {
    await runCommand('list', io);
  } catch (err) {
    line('err', `  ✗  ${err.message}`);
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const raw = input.value;
  input.value = '';
  html('cmd', `<span class="ps1">todo&gt;</span> ${esc(raw)}`);
  if (!raw.trim()) return;
  try {
    await runCommand(raw, io);
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
  await refresh();
  html('', '');
  line('dim', '  type "help" for commands.');
  html('', '');
})();
