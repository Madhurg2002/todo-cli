#!/usr/bin/env node
/**
 * Test harness: boots a throwaway Postgres cluster, exports
 * DATABASE_URL/TEST_DATABASE_URL pointing at it, runs the given command
 * (e.g. `npm run verify`) inside that environment, then tears everything
 * down. Everything happens inside one foreground process tree.
 *
 * Why not the `embedded-postgres` package: this sandbox runs as root, and
 * that library setuid's to a `postgres` OS user which cannot traverse
 * /home/daytona — every binary spawn fails with EACCES. Instead we copy
 * the Postgres 18 binaries (bundled with that package) to /tmp, where any
 * user can traverse, and run them as an unprivileged user via
 * spawn({ uid, gid }). Postgres refuses to run as root, so when the harness
 * itself is root we drop to PG_RUN_AS (default: `daytona`); when it is
 * already unprivileged (CI, dev machines) we just run as ourselves.
 *
 * Usage: node scripts/run-with-pg.mjs <command...>
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const nativeDir = path.join(
  root,
  'node_modules',
  '@embedded-postgres',
  'linux-x64',
  'native'
);

const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const RUN_AS = process.env.PG_RUN_AS || 'daytona'; // only used when we are root
let uid;
let gid;
if (isRoot) {
  try {
    uid = Number.parseInt(execSync(`id -u ${RUN_AS}`).toString().trim(), 10);
    gid = Number.parseInt(execSync(`id -g ${RUN_AS}`).toString().trim(), 10);
  } catch {
    console.error(`running as root and no "${RUN_AS}" user available; cannot run Postgres`);
    process.exit(2);
  }
}

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-pg-'));
// mkdtemp creates 0700; the run-as user must be able to traverse every level.
fs.chmodSync(work, 0o755);
const binDir = path.join(work, 'bin');
const dataDir = path.join(work, 'data');
const PORT = 55432;
const URL_ = `postgres://postgres:postgres@127.0.0.1:${PORT}/postgres`;

function run(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
  const child = spawn(cmd, args, {
    ...(uid === undefined ? {} : { uid, gid }),
    env: { ...process.env, LC_MESSAGES: 'C' },
    ...opts,
  });
    let err = '';
    child.stderr?.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(child) : reject(new Error(`${cmd} exited ${code}: ${err.slice(-400)}`))));
  });
}

// 1. world-traversable copy of the server binaries, owned by the run-as user
fs.cpSync(nativeDir, binDir, { recursive: true });
if (isRoot) execSync(`chown -R ${uid}:${gid} ${JSON.stringify(binDir)}`);
fs.chmodSync(binDir, 0o755);
for (const f of fs.readdirSync(path.join(binDir, 'bin'))) {
  fs.chmodSync(path.join(binDir, 'bin', f), 0o755);
}
fs.mkdirSync(dataDir, { recursive: true });
if (isRoot) {
  fs.chownSync(binDir, uid, gid);
  fs.chownSync(dataDir, uid, gid);
}

const pwFile = path.join(work, 'pw');
fs.writeFileSync(pwFile, 'postgres\n');
if (isRoot) fs.chownSync(pwFile, uid, gid);

const initdb = path.join(binDir, 'bin', 'initdb');
const postgres = path.join(binDir, 'bin', 'postgres');

// 2. init the cluster (postgres refuses to run as root — we are daytona)
await run(initdb, [
  '--pgdata=' + dataDir,
  '--username=postgres',
  '--auth=password',
  `--pwfile=${pwFile}`,
  '--lc-messages=C',
]);
console.log(`[run-with-pg] cluster initialised (as ${isRoot ? RUN_AS : 'self'})`);

// 3. start the server, wait for readiness
const server = spawn(postgres, ['-D', dataDir, '-p', String(PORT), '-k', dataDir], {
  ...(uid === undefined ? {} : { uid, gid }),
  env: { ...process.env, LC_MESSAGES: 'C' },
});
await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('postgres did not become ready')), 30_000);
  let out = '';
  server.stdout?.on('data', (d) => (out += d.toString()));
  server.stderr?.on('data', (d) => {
    out += d.toString();
    if (out.includes('database system is ready to accept connections')) {
      clearTimeout(timer);
      resolve();
    }
  });
  server.on('close', () => {
    clearTimeout(timer);
    reject(new Error(`postgres exited early:\n${out.slice(-500)}`));
  });
});
console.log(`[run-with-pg] postgres ready → ${URL_}`);

const [, , ...cmd] = process.argv;
if (cmd.length === 0) {
  console.error('usage: node scripts/run-with-pg.mjs <command...>');
  process.exit(2);
}

// 4. run the suite inside the environment
const child = spawn(cmd[0], cmd.slice(1), {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: URL_, TEST_DATABASE_URL: URL_ },
  cwd: root,
});

let suiteCode = 1;
child.on('exit', async (code) => {
  suiteCode = code ?? 1;
  console.log(`[run-with-pg] suite finished with exit code ${suiteCode}`);
  server.kill('SIGTERM');
});
server.on('close', () => {
  fs.rmSync(work, { recursive: true, force: true });
  console.log('[run-with-pg] postgres stopped, temp cluster removed');
  process.exit(suiteCode);
});
