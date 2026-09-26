/**
 * API smoke tests: boots the Express app on an ephemeral port with a
 * throwaway TASKS_FILE and exercises every endpoint. No new deps.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-api-test-'));
const tasksFile = path.join(tmp, 'tasks.json');

let failures = 0;

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`✔ ${name}`);
  } else {
    failures++;
    console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
  }
}

async function j(method, p, body) {
  const res = await fetch(`http://127.0.0.1:${PORT}${p}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const server = spawn('node', [path.resolve('server/start.js')], {
  env: { ...process.env, TASKS_FILE: tasksFile, PORT: '0', HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stderr.on('data', (d) => (serverLog += d));

// PORT=0 makes the OS pick a port; the app logs it on startup.
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

try {
  // health
  const health = await j('GET', '/api/health');
  check('health returns ok', health.status === 200 && health.body.ok === true);

  // create
  const created = await j('POST', '/api/tasks', { text: '  api task  ', priority: 'high' });
  check('create returns 201 with trimmed text and priority',
    created.status === 201 &&
    created.body.task.text === 'api task' &&
    created.body.task.priority === 'high' &&
    created.body.task.status === 'todo' &&
    typeof created.body.task.id === 'string');

  const badCreate = await j('POST', '/api/tasks', { text: '' });
  check('empty text rejected with 400', badCreate.status === 400);
  const badPriority = await j('POST', '/api/tasks', { text: 'x', priority: 'urgent' });
  check('bad priority rejected with 400', badPriority.status === 400);

  const id = created.body.task.id;

  // list + filters
  await j('POST', '/api/tasks', { text: 'second task', priority: 'low' });
  const all = await j('GET', '/api/tasks');
  check('list returns both tasks', all.status === 200 && all.body.count === 2);

  const highOnly = await j('GET', '/api/tasks?priority=high');
  check('priority filter works', highOnly.body.count === 1 && highOnly.body.tasks[0].id === id);

  // patch status
  const doneTask = await j('PATCH', `/api/tasks/${id}`, { status: 'done' });
  check('patch to done sets completedAt',
    doneTask.status === 200 && doneTask.body.task.status === 'done' && doneTask.body.task.completedAt);

  const badStatus = await j('PATCH', `/api/tasks/${id}`, { status: 'finished' });
  check('bad status rejected with 400', badStatus.status === 400);
  const missing = await j('PATCH', '/api/tasks/does-not-exist', { status: 'done' });
  check('missing task returns 404', missing.status === 404);

  // stats
  const stats = await j('GET', '/api/stats');
  check('stats reflect one done of two',
    stats.status === 200 && stats.body.total === 2 && stats.body.done === 1 && stats.body.percentDone === 50);

  // delete
  const del = await j('DELETE', `/api/tasks/${id}`);
  check('delete removes the task', del.status === 200 && del.body.removed.id === id);
  const delAgain = await j('DELETE', `/api/tasks/${id}`);
  check('double delete returns 404', delAgain.status === 404);

  // corrupted store -> 500 with message
  fs.writeFileSync(tasksFile, '{nope');
  const corrupted = await j('GET', '/api/tasks');
  check('corrupted store maps to 500 with message',
    corrupted.status === 500 && String(corrupted.body.error).includes('corrupted'));
} finally {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll API tests passed.' : `\n${failures} API test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
