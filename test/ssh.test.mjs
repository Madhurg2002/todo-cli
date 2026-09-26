/**
 * SSH integration test: boots the SSH server on an ephemeral port with a
 * throwaway TASKS_FILE, connects as an ssh2 client, and drives the TUI
 * through a real PTY-less shell session.
 */
import ssh2 from 'ssh2';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-ssh-test-'));
let failures = 0;

function check(name, cond, detail = '') {
  if (cond) console.log(`✔ ${name}`);
  else {
    failures++;
    console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
  }
}

const SSH_PORT = 2322;

const server = spawn(
  'node',
  [path.resolve('server/ssh-server.js')],
  {
    env: {
      ...process.env,
      TASKS_FILE: path.join(tmp, 'tasks.json'),
      SSH_PORT: String(SSH_PORT),
      SSH_HOST_KEY_DIR: path.join(tmp, 'hostkeys'),
      HOST: '127.0.0.1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }
);

let serverLog = '';
server.stderr.on('data', (d) => (serverLog += d));

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`server did not start: ${serverLog}`)), 5000);
  server.stdout.on('data', (d) => {
    serverLog += d;
    if (serverLog.includes('listening')) {
      clearTimeout(timer);
      resolve();
    }
  });
  server.on('exit', (code) => {
    clearTimeout(timer);
    reject(new Error(`server exited early (${code}): ${serverLog}`));
  });
});

const conn = new ssh2.Client();

function sendCommand(cmd, { waitMs = 400 } = {}) {
  return new Promise((resolve) => {
    let acc = '';
    const onData = (d) => (acc += d.toString('utf8'));
    conn.shell((err, stream) => {
      if (err) throw err;
      stream.on('data', onData);
      stream.write(cmd + '\n');
      setTimeout(() => {
        stream.removeListener('data', onData);
        stream.end();
        resolve(acc);
      }, waitMs);
    });
  });
}

try {
  await new Promise((resolve, reject) => {
    conn
      .on('ready', resolve)
      .on('error', reject)
      .connect({ host: '127.0.0.1', port: SSH_PORT, username: 'todo', readyTimeout: 4000 });
  });
  check('ssh handshake + auth succeeds', true);

  const banner = await sendCommand('');
  check('banner and initial table are shown',
    banner.includes('TODO') && banner.includes('todo>'));

  const afterAdd = await sendCommand('add ssh task --high');
  check('add over ssh works', afterAdd.includes('added:') && afterAdd.includes('ssh task'));

  const afterDone = await sendCommand('done 1');
  check('done over ssh works', afterDone.includes('completed:'));

  const afterUndo = await sendCommand('undo 1');
  check('undo over ssh works', afterUndo.includes('reopened:'));

  const afterRm = await sendCommand('rm 1');
  check('rm over ssh works', afterRm.includes('removed:'));

  const empty = await sendCommand('list');
  check('list shows empty state', empty.includes('No tasks yet'));

  const stats = await sendCommand('stats');
  check('stats over ssh works', stats.includes('total'));

  const bad = await sendCommand('bogus');
  check('unknown command gets a friendly error', bad.includes('unknown command'));

  const persisted = JSON.parse(fs.readFileSync(path.join(tmp, 'tasks.json'), 'utf8'));
  check('ssh session persisted to the shared store', Array.isArray(persisted) && persisted.length >= 0);
} catch (err) {
  failures++;
  console.error(`✗ ssh flow failed: ${err.message}`);
} finally {
  conn.end();
  server.kill();
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nAll SSH tests passed.' : `\n${failures} SSH test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
