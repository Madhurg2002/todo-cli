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
  env: { ...process.env, TODO_DATA_DIR: dataDir, PORT: '0', HOST: '127.0.0.1', RATE_LIMIT: 'off' },
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
  let alice = client();
  const bob = client();

  const reg = await alice('POST', '/api/auth/register', { username: 'alice', password: 'secret123' });
  check('register returns 201 + user + token', reg.status === 201 && reg.body.user.username === 'alice' && typeof reg.body.token === 'string');
  check('register sets a session cookie', reg.cookie.startsWith('todo_session='));

  const me = await alice('GET', '/api/auth/me');
  check('me resolves the session', me.status === 200 && me.body.user.username === 'alice');

  // Bearer token path (for scripts/status bars)
  const bearer = await fetch(`http://127.0.0.1:${PORT}/api/tasks`, {
    headers: { authorization: `Bearer ${reg.body.token}` },
  });
  check('Bearer token works like a cookie', bearer.status === 200);

  const anon = client();
  check('me without session → 401', (await anon('GET', '/api/auth/me')).status === 401);
  check('tasks without session → 401', (await anon('GET', '/api/tasks')).status === 401);

  const weak = await client()('POST', '/api/auth/register', { username: 'weak', password: '123' });
  check('short password → 400', weak.status === 400);

  // password change flow
  const badPwChange = await alice('POST', '/api/auth/password', { currentPassword: 'nope', newPassword: 'newsecret9' });
  check('password change with wrong current → 403', badPwChange.status === 403);
  const pwChange = await alice('POST', '/api/auth/password', { currentPassword: 'secret123', newPassword: 'newsecret9' });
  check('password change works', pwChange.status === 200);
  const relogin = await client()('POST', '/api/auth/login', { username: 'alice', password: 'newsecret9' });
  check('new password logs in', relogin.status === 200);

  // password change revoked alice's original session; sign her in again
  const alice2 = client();
  const reloginAlice = await alice2('POST', '/api/auth/login', { username: 'alice', password: 'newsecret9' });
  check('alice re-signs in after password change', reloginAlice.status === 200);

  const badName = await client()('POST', '/api/auth/register', { username: 'A!', password: 'secret123' });
  check('invalid username → 400', badName.status === 400);

  const dup = await client()('POST', '/api/auth/register', { username: 'alice', password: 'secret123' });
  check('duplicate username → 409', dup.status === 409);

  const badLogin = await client()('POST', '/api/auth/login', { username: 'alice', password: 'nope' });
  check('wrong password → 401', badLogin.status === 401);

  const fresh = client();
  const login = await fresh('POST', '/api/auth/login', { username: 'alice', password: 'newsecret9' });
  check('login returns a session', login.status === 200 && login.cookie.startsWith('todo_session='));

  // --- tasks (user-scoped) — alice's original cookie was revoked by the
  // password change above, so rebind the name to the fresh session.
  alice = alice2;
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

  // due + tags over the API
  const meta = await alice('POST', '/api/tasks', {
    text: 'meta task',
    priority: 'high',
    due: '2026-10-01T17:00:00.000Z',
    tags: ['#Ops', 'ops'],
  });
  check('create stores due + normalized tags',
    meta.status === 201 &&
    meta.body.task.due === '2026-10-01T17:00:00.000Z' &&
    JSON.stringify(meta.body.task.tags) === JSON.stringify(['ops']));
  check('bad due → 400', (await alice('POST', '/api/tasks', { text: 'x', due: 'nope' })).status === 400);
  check('bad tags → 400', (await alice('POST', '/api/tasks', { text: 'x', tags: 'not-an-array' })).status === 400);

  const patched = await alice('PATCH', `/api/tasks/${meta.body.task.id}`, { due: null, tags: ['new-tag'] });
  check('patch clears due and replaces tags',
    patched.body.task.due === null && JSON.stringify(patched.body.task.tags) === JSON.stringify(['new-tag']));
  check('patch bad due → 400', (await alice('PATCH', `/api/tasks/${meta.body.task.id}`, { due: 'junk' })).status === 400);

  const metaId = meta.body.task.id;
  await alice('PATCH', `/api/tasks/${metaId}`, { due: '2001-01-01T00:00:00.000Z' });
  check('tag filter works', (await alice('GET', '/api/tasks?tag=new-tag')).body.count === 1);
  check('overdue filter works', (await alice('GET', '/api/tasks?overdue=true')).body.count === 1);

  // stats
  const stats = await alice('GET', '/api/stats');
  check('stats reflect one done of three',
    stats.status === 200 && stats.body.total === 3 && stats.body.done === 1 && stats.body.percentDone === 33);
  check('stats count overdue', stats.body.overdue === 1);

  // delete
  check('delete removes the task', (await alice('DELETE', `/api/tasks/${id}`)).status === 200);
  check('double delete → 404', (await alice('DELETE', `/api/tasks/${id}`)).status === 404);
  await alice('DELETE', `/api/tasks/${metaId}`);

  // logout invalidates
  await alice('POST', '/api/auth/logout');
  check('logout invalidates the session', (await alice('GET', '/api/auth/me')).status === 401);

  // sessions list/kill. a2 logs in fresh; otherDevice logs in after it.
  // From a2's view: exactly 2 live sessions, one marked current.
  const a2 = client();
  await a2('POST', '/api/auth/login', { username: 'alice', password: 'newsecret9' });
  const otherDevice = client();
  await otherDevice('POST', '/api/auth/login', { username: 'alice', password: 'newsecret9' });
  const sessList = await a2('GET', '/api/auth/sessions');
  const listed = sessList.body.sessions ?? [];
  check('sessions endpoint lists live sessions', sessList.status === 200 && listed.length >= 2);
  const current = listed.find((s) => s.current);
  const others = listed.filter((s) => !s.current);
  check('one session is marked current', Boolean(current) && others.length >= 1);
  check('kill other session', (await a2('DELETE', `/api/auth/sessions/${others[0].id}`)).status === 200);
  // kill every remaining non-current session (some belong to otherDevice)
  for (const s of others.slice(1)) {
    await a2('DELETE', `/api/auth/sessions/${s.id}`);
  }
  check('killed session is dead', (await otherDevice('GET', '/api/auth/me')).status === 401);
  check('kill unknown session → 404', (await a2('DELETE', '/api/auth/sessions/zzzznope')).status === 404);
  check('current session survives the kill', (await a2('GET', '/api/auth/me')).status === 200);

  // account deletion
  const del = await a2('DELETE', '/api/auth/account', { password: 'newsecret9' });
  check('account deletion works', del.status === 200);
  check('deleted account cannot log in', (await client()('POST', '/api/auth/login', { username: 'alice', password: 'newsecret9' })).status === 401);

  // corrupted store → 500 (file mode only; PG mode has no corruptible file)
  const freshSession = client();
  await freshSession('POST', '/api/auth/login', { username: 'bob', password: 'secret123' });
  const bobId = (await freshSession('GET', '/api/auth/me')).body.user.id;
  if (process.env.DATABASE_URL) {
    check('corrupted store → 500 with message', true, 'skipped: postgres mode has no corruptible file store');
  } else {
    fs.writeFileSync(path.join(dataDir, 'tasks', `${bobId}.json`), '{nope');
    const corrupted = await freshSession('GET', '/api/tasks');
    check('corrupted store → 500 with message',
      corrupted.status === 500 && String(corrupted.body.error).includes('corrupted'),
      `got ${corrupted.status} ${JSON.stringify(corrupted.body)}`);
  }

  // bad filter → 400 (shared validation). bob's store is corrupted by the
  // check above, so use a fresh account for the filter check.
  const carol = client();
  await carol('POST', '/api/auth/register', { username: 'carol', password: 'secret123' });
  const badFilter = await carol('GET', '/api/tasks?status=weird');
  check('bad status filter → 400', badFilter.status === 400);
} catch (err) {
  failures++;
  console.error(`✗ suite crashed: ${err.message}`);
} finally {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll API tests passed.' : `\n${failures} API test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
