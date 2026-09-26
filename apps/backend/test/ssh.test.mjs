/**
 * SSH integration test: boots the SSH server on an ephemeral port with
 * a throwaway data dir, creates two accounts, and drives the TUI as a
 * real ssh2 client — including auth rejection and per-user isolation.
 */
import ssh2 from 'ssh2';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-ssh-test-'));
const dataDir = path.join(tmp, 'data');
const SSH_PORT = 2432;

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) console.log(`✔ ${name}`);
  else {
    failures++;
    console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
  }
}

// Boot the combined server so accounts can be created over HTTP first.
const server = spawn('node', [path.resolve('apps/backend/server/all.js')], {
  env: {
    ...process.env,
    TODO_DATA_DIR: dataDir,
    SSH_PORT: String(SSH_PORT),
    SSH_HOST_KEY_DIR: path.join(tmp, 'hostkeys'),
    TASKS_FILE: path.join(tmp, 'tasks.json'),
    PORT: '0',
    HOST: '127.0.0.1',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stderr.on('data', (d) => (serverLog += d));

const HTTP_PORT = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`server did not start: ${serverLog}`)), 6000);
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

async function register(username, password) {
  const res = await fetch(`http://127.0.0.1:${HTTP_PORT}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return res.status;
}

function connect(username, password) {
  return new Promise((resolve, reject) => {
    const conn = new ssh2.Client();
    conn
      .on('ready', () => resolve(conn))
      .on('error', (err) => reject(err))
      .connect({ host: '127.0.0.1', port: SSH_PORT, username, password, readyTimeout: 4000 });
  });
}

/** Run a command over a fresh shell and collect the output. */
function sendCommand(conn, cmd, { waitMs = 400 } = {}) {
  return new Promise((resolve, reject) => {
    let acc = '';
    conn.shell((err, stream) => {
      if (err) return reject(err);
      stream.on('data', (d) => (acc += d.toString('utf8')));
      stream.write(cmd + '\n');
      setTimeout(() => {
        stream.end();
        resolve(acc);
      }, waitMs);
    });
  });
}

try {
  check('register alice', (await register('alice', 'secret123')) === 201);
  check('register bob', (await register('bob', 'secret123')) === 201);

  // --- auth rejection -----------------------------------------------------
  let rejected = false;
  try {
    const bad = await connect('alice', 'wrong-password');
    bad.end();
  } catch {
    rejected = true;
  }
  check('wrong password is rejected', rejected);

  let unknownRejected = false;
  try {
    const ghost = await connect('nobody', 'whatever');
    ghost.end();
  } catch {
    unknownRejected = true;
  }
  check('unknown account is rejected', unknownRejected);

  // --- authenticated session ---------------------------------------------
  const conn = await connect('alice', 'secret123');
  check('ssh handshake + password auth succeeds', true);

  const banner = await sendCommand(conn, '');
  check('banner shows the signed-in account', banner.includes('alice') && banner.includes('todo>'));

  const afterAdd = await sendCommand(conn, 'add ssh task --high');
  check('add over ssh works', afterAdd.includes('added:') && afterAdd.includes('ssh task'));

  const list = await sendCommand(conn, 'list');
  check('list shows progress bar', list.includes('%') && list.includes('ssh task'));

  check('done over ssh works', (await sendCommand(conn, 'done 1')).includes('completed:'));
  check('undo over ssh works', (await sendCommand(conn, 'undo 1')).includes('reopened:'));
  check('edit over ssh works', (await sendCommand(conn, 'edit 1 edited by ssh')).includes('updated:'));
  check('stats over ssh works', (await sendCommand(conn, 'stats')).includes('total:'));
  check('whoami over ssh works', (await sendCommand(conn, 'whoami')).includes('alice'));
  check('rm over ssh works', (await sendCommand(conn, 'rm 1')).includes('removed:'));

  const empty = await sendCommand(conn, 'list');
  check('list shows empty state', empty.includes('No tasks yet'));

  const bad = await sendCommand(conn, 'bogus');
  check('unknown command gets a friendly error', bad.includes('unknown command'));

  // --- per-user isolation over ssh ---------------------------------------
  const bobConn = await connect('bob', 'secret123');
  const bobList = await sendCommand(bobConn, 'list');
  check("bob's ssh session is a separate store", bobList.includes('No tasks yet'));
  await sendCommand(bobConn, 'add bob task');
  const bobList2 = await sendCommand(bobConn, 'list');
  check("bob's task appears for bob", bobList2.includes('bob task'));

  const aliceList = await sendCommand(conn, 'list');
  check("alice does not see bob's task", !aliceList.includes('bob task'));

  bobConn.end();
  conn.end();
} catch (err) {
  failures++;
  console.error(`✗ ssh suite failed: ${err.message}`);
} finally {
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll SSH tests passed.' : `\n${failures} SSH test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
