/**
 * Web-path verification: runs the shared command grammar against a live
 * server through the same REST-backed store adapter the browser client
 * uses, with a real session cookie. This proves the web path works
 * without needing a browser.
 */
process.env.PORT = process.env.PORT || '3888';
process.env.HOST = '127.0.0.1';
process.env.SSH_PORT = process.env.SSH_PORT || '2401';
process.env.TODO_DATA_DIR = process.env.TODO_DATA_DIR || '/tmp/verify-web';
process.env.RATE_LIMIT = 'off';

import fs from 'fs';
fs.rmSync(process.env.TODO_DATA_DIR, { recursive: true, force: true });

import path from 'path';
import { fileURLToPath } from 'url';
import { runCommand } from '../packages/shared/commands.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = `http://127.0.0.1:${process.env.PORT}`;
import(path.join(root, 'apps/backend/server/all.js').replace(/\\/g, '/'));

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✔' : '✗'} ${name}${!cond && detail ? `: ${detail}` : ''}`);
  if (!cond) failures++;
};

let cookie = '';

async function api(p, opts = {}) {
  const res = await fetch(base + p, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(opts.headers ?? {}) },
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || res.statusText), { status: res.status });
  return body;
}

/** Exactly the adapter shape apps/frontend/public/app.js provides. */
const restStore = {
  list: () => api('/api/tasks'),
  create: async ({ text, priority, due, tags }) =>
    (await api('/api/tasks', { method: 'POST', body: JSON.stringify({ text, priority, due, tags }) })).task,
  update: async (id, patch) => (await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })).task,
  setStatus: async (id, done) => (await api(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify({ status: done ? 'done' : 'todo' }) })).task,
  remove: async (id) => { await api(`/api/tasks/${id}`, { method: 'DELETE' }); },
  stats: () => api('/api/stats'),
};

setTimeout(async () => {
  const lines = [];
  const ctx = {
    store: restStore,
    username: 'webuser',
    write: (cls, text) => lines.push(`${cls}|${text}`),
  };
  const out = () => lines.join('\n');

  try {
    await api('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'webuser', password: 'secret123' }) });
    check('registered + session cookie', cookie.startsWith('todo_session='));

    await runCommand('add from the web --high --due tomorrow --tag web,dev', ctx);
    await runCommand('add second task', ctx);
    await runCommand('list', ctx);
    check('add + list render through REST', out().includes('from the web') && out().includes('second task'));
    check('due + tags render through the REST store', out().includes('#web') && out().includes('⏳'));

    const created = (await api('/api/tasks')).tasks.find((t) => t.text === 'from the web');
    check('REST store persisted due + tags',
      Boolean(created?.due) && JSON.stringify(created?.tags) === JSON.stringify(['web', 'dev']));

    // both tasks are still open here: #1 = "from the web" (high),
    // #2 = "second task" (med) — numbers are positions in this sorted view.
    await runCommand('due 2 friday', ctx);
    await runCommand('tag 2 ssh', ctx);
    const second = (await api('/api/tasks')).tasks.find((t) => t.text === 'second task');
    check('due/tag commands mutate through REST',
      Boolean(second?.due) && second?.tags?.includes('ssh'));

    await runCommand('done 1', ctx);
    check('done marks complete', out().includes('completed:'));

    await runCommand('edit 1 edited via web', ctx);
    check('edit works from the web path', out().includes('updated: "edited via web"'));

    await runCommand('stats', ctx);
    check('stats works', out().includes('total: 2'));

    await runCommand('list +ssh', ctx);
    check('tag filter works over REST', out().includes('edited via web'));

    await runCommand('rm 2', ctx);
    await runCommand('list', ctx);
    check('rm works', out().includes('removed:'));

    await runCommand('whoami', ctx);
    check('whoami shows account', out().includes('webuser'));

    // the shared grammar file the browser loads must be importable as-is
    const bundle = await (await fetch(`${base}/vendor/shared-commands.js`)).text();
    const mod = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString('base64')}`);
    check('browser bundle exports runCommand', typeof mod.runCommand === 'function');
    check('browser bundle exports parseDueDate', typeof mod.parseDueDate === 'function');
    check('browser bundle has no node imports', !bundle.includes("from '"));
  } catch (err) {
    check('web flow', false, err.message);
  }

  console.log(failures === 0 ? '\nWeb-path verification passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}, 2000);
