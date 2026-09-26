/**
 * API + accounts integration tests. Boots the Express app on an
 * ephemeral port with a throwaway TODO_DATA_DIR and exercises auth,
 * per-user task isolation, CRUD, validation and error paths.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-api-test-'));
const dataDir = path.join(tmp, 'data');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`✔ ${name}`);
  else {
    failures++;
    console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const server = spawn('node', [path.resolve('apps/backend/server/start.js')], {
  env: { ...process.env, TODO_DATA_DIR: dataDir, PORT: '0', HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stderr.on('data', (d) => (serverLog += d));

const PORT = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`server did not start: ${serverLog}`)), 5000);
  server.stdout.on('data', (d) => {
    serverLog += d;
    const m = serverLog.match(/127\.0\.0\.1:(\d+)/);
    if (m) {
      clearTimeout(timer);
      resolve(m[1]);
    }
  });
  server.on('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`server exited early (${code}): ${serverLog}`));
  });
});

/** fetch helper that carries a session cookie per "client". */
function client() {
  let cookie = '';
  return async (method, p, body) => {
    const res = await fetch(`http://127.0.0.1:${PORT}${p}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(cookie ? { cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    return { status: res.status, body: await res.json().catch(() => ({})), cookie };
  };
}

try {
  // --- health is public ---------------------------------------------------
  {
    const anon = client();
    const health = await anon('GET', '/api/health');
    check('health needs no session', health.status === 200 && health.body.ok === true);
  }

  // --- registration / login ----------------------------------------------
  const alice = client();
  const bob = client();

  const reg = await alice('POST', '/api/auth/register', { username: 'alice', password: 'secret123' });
  check('register returns 201 + user', reg.status === 201 && reg.body.user.username === 'alice');
  check('register sets a session cookie', reg.cookie.startsWith('todo_session='));

  const me = await alice('GET', '/api/auth/me');
  check('me resolves the session', me.status === 200 && me.body.user.username === 'alice');

  const anon = client();
  check('me without session → 401', (await anon('GET', '/api/auth/me')).status === 401);
  check('tasks without session → 401', (await anon('GET', '/api/tasks')).status === 401);

  const weak = await client()('POST', '/api/auth/register', { username: 'weak', password: '123' });
  check('short password → 400', weak.status === 400);

  const badName = await client()('POST', '/api/auth/register', { username: 'A!', password: 'secret123' });
  check('invalid username → 400', badName.status === 400);

  const dup = await client()('POST', '/api/auth/register', { username: 'alice', password: 'secret123' });
  check('duplicate username → 409', dup.status === 409);

  const badLogin = await client()('POST', '/api/auth/login', { username: 'alice', password: 'nope' });
  check('wrong password → 401', badLogin.status === 401);

  const fresh = client();
  const login = await fresh('POST', '/api/auth/login', { username: 'alice', password: 'secret123' });
  check('login returns a session', login.status === 200 && login.cookie.startsWith('todo_session='));

  // --- tasks (user-scoped) ------------------------------------------------
  const created = await alice('POST', '/api/tasks', { text: '  api task  ', priority: 'high' });
  check('create returns 201, trims text, keeps priority',
    created.status === 201 && created.body.task.text === 'api task' && created.body.task.priority === 'high');
  const id = created.body.task.id;

  check('empty text → 400', (await alice('POST', '/api/tasks', { text: '' })).status === 400);
  check('bad priority → 400', (await alice('POST', '/api/tasks', { text: 'x', priority: 'urgent' })).status === 400);

  const list = await alice('GET', '/api/tasks');
  check('list shows the task', list.status === 200 && list.body.count === 1);

  // per-user isolation
  const regBob = await bob('POST', '/api/auth/register', { username: 'bob', password: 'secret123' });
  check('second user registers', regBob.status === 201);
  const bobList = await bob('GET', '/api/tasks');
  check('bob sees an empty, separate store', bobList.status === 200 && bobList.body.count === 0);
  const aliceCross = await bob('GET', `/api/tasks/${id}`);
  check("bob cannot read alice's task by id", aliceCross.status === 404);

  // patch
  const doneTask = await alice('PATCH', `/api/tasks/${id}`, { status: 'done' });
  check('patch to done sets completedAt',
    doneTask.status === 200 && doneTask.body.task.status === 'done' && doneTask.body.task.completedAt);
  check('patch text', (await alice('PATCH', `/api/tasks/${id}`, { text: 'renamed' })).body.task.text === 'renamed');
  check('bad status → 400', (await alice('PATCH', `/api/tasks/${id}`, { status: 'finished' })).status === 400);
  check('missing task → 404', (await alice('PATCH', '/api/tasks/does-not-exist', { status: 'done' })).status === 404);

  // filters
  await alice('POST', '/api/tasks', { text: 'second', priority: 'low' });
  check('priority filter works', (await alice('GET', '/api/tasks?priority=low')).body.count === 1);
  check('status filter works', (await alice('GET', '/api/tasks?status=done')).body.count === 1);
  check('status filter todo works', (await alice('GET', '/api/tasks?status=todo')).body.count === 1);

  // stats
  const stats = await alice('GET', '/api/stats');
  check('stats reflect one done of two',
    stats.status === 200 && stats.body.total === 2 && stats.body.done === 1 && stats.body.percentDone === 50);

  // delete
  check('delete removes the task', (await alice('DELETE', `/api/tasks/${id}`)).status === 200);
  check('double delete → 404', (await alice('DELETE', `/api/tasks/${id}`)).status === 404);

  // logout invalidates
  await alice('POST', '/api/auth/logout');
  check('logout invalidates the session', (await alice('GET', '/api/auth/me')).status === 401);

  // corrupted store → 500
  const freshSession = client();
  await freshSession('POST', '/api/auth/login', { username: 'bob', password: 'secret123' });
  const bobId = (await freshSession('GET', '/api/auth/me')).body.user.id;
  fs.writeFileSync(path.join(dataDir, 'tasks', `${bobId}.json`), '{nope');
  const corrupted = await freshSession('GET', '/api/tasks');
  check('corrupted store → 500 with message',
    corrupted.status === 500 && String(corrupted.body.error).includes('corrupted'));
} catch (err) {
  failures++;
  console.error(`✗ suite crashed: ${err.message}`);
} finally {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll API tests passed.' : `\n${failures} API test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
