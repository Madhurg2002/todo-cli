process.env.PORT = process.env.PORT || '3777';
process.env.HOST = '127.0.0.1';
process.env.SSH_PORT = process.env.SSH_PORT || '2399';
process.env.TODO_DATA_DIR = process.env.TODO_DATA_DIR || '/tmp/verify-accounts';

import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const base = `http://127.0.0.1:${process.env.PORT}`;
import(path.join(root, 'apps/backend/server/all.js').replace(/\\/g, '/'));

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? '✔' : '✗'} ${name}`);
  if (!cond) failures++;
};

const json = async (p, opts = {}, cookie = '') => {
  const res = await fetch(base + p, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  });
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: (setCookie ?? '').split(';')[0] };
};

setTimeout(async () => {
  const reg = await json('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: 'alice', password: 'secret123' }),
  });
  check(`register (${reg.status})`, reg.status === 201 && reg.body.user.username === 'alice');
  const alice = reg.cookie;

  check('me with session', (await json('/api/auth/me', {}, alice)).body.user?.username === 'alice');
  check('me without session → 401', (await json('/api/auth/me')).status === 401);
  check('tasks without session → 401', (await json('/api/tasks')).status === 401);

  const created = await json('/api/tasks', { method: 'POST', body: JSON.stringify({ text: 'alice task', priority: 'high' }) }, alice);
  check(`create (${created.status})`, created.status === 201);

  const reg2 = await json('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'bob', password: 'secret123' }) });
  const bob = reg2.cookie;
  const bobList = await json('/api/tasks', {}, bob);
  check(`bob sees no alice tasks (count=${bobList.body.count})`, bobList.body.count === 0);

  const badLogin = await json('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'wrong' }) });
  check('wrong password → 401', badLogin.status === 401);

  const dup = await json('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'alice', password: 'secret123' }) });
  check(`duplicate username → 409 (${dup.status})`, dup.status === 409);

  check('stats works', (await json('/api/stats', {}, alice)).body.total === 1);

  await json('/api/auth/logout', { method: 'POST' }, alice);
  check('logout invalidates session', (await json('/api/auth/me', {}, alice)).status === 401);

  console.log(failures === 0 ? '\nAccounts check passed.' : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}, 2000);
