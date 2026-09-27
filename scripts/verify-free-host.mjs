#!/usr/bin/env node
/**
 * Free-host deployment rehearsal.
 *
 * Proves the thing the $0 hosting story depends on, without needing a Render
 * account: that accounts, sessions and tasks survive a *total* loss of local
 * state, because they live in Postgres and not on disk.
 *
 * It deliberately runs the exact command the Render blueprint runs —
 * `node apps/backend/server/start.js` — and then:
 *
 *   1. boots it with DATABASE_URL set and a TODO_DATA_DIR,
 *   2. registers an account, creates a task, keeps the session cookie,
 *   3. makes the database endpoint refuse connections for a moment, the way
 *      a free serverless Postgres refuses them while it wakes up, then logs
 *      in again (this is the request that would 500 without retries),
 *   4. terminates every live database connection, simulating the recycled
 *      sockets the app was holding,
 *   5. kills the process and **deletes the data directory** — the container
 *      is now exactly what a fresh Render free instance looks like,
 *   6. starts a brand-new process against the same database and checks that
 *      the old session cookie, the account and its task all still work.
 *
 * Requires a Postgres to test against:
 *   npm run test:pg          (boots a throwaway cluster and runs this)
 *   TEST_DATABASE_URL=... npm run verify:free-host   (against your own)
 */
import fs from 'fs';
import os from 'os';
import net from 'net';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.FREE_HOST_PORT || 3901);
const HOST = '127.0.0.1';
const base = `http://${HOST}:${PORT}`;
// A fresh directory per run: it gets deleted mid-test, and the second pass
// must work with nothing in it.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-freehost-'));
const USER = 'rehearsal';
const PASSWORD = 'secret123';

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`${cond ? '✔' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failures++;
  return cond;
};

/**
 * A TCP proxy in front of the database that can be switched "offline".
 *
 * A free serverless Postgres suspends its compute when it sees no traffic.
 * The first connection attempt after that suspension does not succeed: the
 * endpoint refuses it while the database wakes. Terminating the existing
 * connections is *not* a faithful stand-in — node-postgres evicts dead idle
 * clients by itself and re-dials, so that case never surfaces as an error.
 * Refusing new connections is the case the app actually has to survive, so
 * that is what this reproduces.
 *
 * Only usable over plain TCP; a TLS-terminating endpoint (sslmode=require,
 * which is what a hosted database gives you) is passed through untouched and
 * the outage check reports itself as skipped rather than passing silently.
 */
function startDatabaseProxy(realUrl) {
  const url = new URL(realUrl);
  const wantsTls = url.searchParams.get('sslmode') && url.searchParams.get('sslmode') !== 'disable';
  if (wantsTls) return { supported: false, url: realUrl };

  const target = { host: url.hostname, port: Number(url.port || 5432) };
  let online = true;
  const live = new Set();

  const server = net.createServer((client) => {
    if (!online) {
      client.destroy(); // the endpoint is asleep: no connection is accepted
      return;
    }
    const upstream = net.connect(target);
    const pair = { client, upstream };
    live.add(pair);
    client.pipe(upstream);
    upstream.pipe(client);
    const close = () => {
      live.delete(pair);
      client.destroy();
      upstream.destroy();
    };
    client.on('error', close);
    upstream.on('error', close);
    client.on('close', close);
    upstream.on('close', close);
  });

  const listen = () =>
    new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });

  return {
    supported: true,
    async url() {
      if (!server.listening) await listen();
      const proxied = new URL(realUrl);
      proxied.hostname = '127.0.0.1';
      proxied.port = String(server.address().port);
      return proxied.toString();
    },
    goOffline() {
      online = false;
      // A suspended database takes its live connections with it; the pooled
      // sockets the app is holding become useless.
      for (const { client, upstream } of live) {
        client.destroy();
        upstream.destroy();
      }
      live.clear();
    },
    goOnline() {
      online = true;
    },
    /** Simulate the endpoint coming back once the database has "woken". */
    async wake(ms) {
      await new Promise((r) => setTimeout(r, ms));
      online = true;
    },
    get live() {
      return live.size;
    },
    async close() {
      await new Promise((r) => server.close(r));
    },
  };
}

/** Boot the production entrypoint exactly as Render does. */
function startServer(databaseUrl) {
  const child = spawn(process.execPath, ['apps/backend/server/start.js'], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST,
      DATABASE_URL: databaseUrl,
      TODO_DATA_DIR: DATA_DIR,
      // The blueprint sets TRUST_PROXY=1; harmless over plain HTTP and it
      // exercises the same cookie configuration the deploy will use.
      TRUST_PROXY: '1',
      PUBLIC_URL: base,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.env.VERBOSE && process.stdout.write(`[server] ${d}`));
  child.stderr.on('data', (d) => process.env.VERBOSE && process.stdout.write(`[server] ${d}`));
  return child;
}

/** Wait until /api/health answers, or give up. */
async function waitReady(child, label) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`${label}: server exited early (code ${child.exitCode})`);
    try {
      const res = await fetch(`${base}/api/health`);
      if (res.ok) return await res.json();
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`${label}: server never became ready`);
}

function stop(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null) return resolve();
    child.on('exit', () => resolve());
    child.kill('SIGTERM');
    setTimeout(() => child.kill('SIGKILL'), 3000).unref();
  });
}

const json = async (p, opts = {}, cookie = '') => {
  const res = await fetch(base + p, {
    ...opts,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
  });
  const setCookie = res.headers.get('set-cookie');
  return { status: res.status, body: await res.json().catch(() => ({})), cookie: (setCookie ?? '').split(';')[0] };
};

/**
 * Kill every other connection to the database. This is what a suspended or
 * recycled free-tier database looks like to a live connection pool: the
 * sockets are gone, and the next query fails until the pool re-dials.
 */
async function killAllDatabaseConnections() {
  const pg = await import('pg');
  const Pool = pg.default?.Pool ?? pg.Pool;
  const client = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    const me = await client.query('SELECT pg_backend_pid() AS pid');
    const { rows } = await client.query(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> $1',
      [me.rows[0].pid]
    );
    return rows.length;
  } finally {
    await client.end().catch(() => {});
  }
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required — run this via: npm run test:pg');
  process.exit(2);
}

let server;
let proxy;
try {
  // Every server instance talks to the database through the proxy, so the
  // outage can be injected at any point.
  proxy = startDatabaseProxy(process.env.DATABASE_URL);
  const dbUrl = await proxy.url();

  // --- pass 1: a brand new container -------------------------------------
  console.log(`\npass 1 — cold start, empty disk at ${DATA_DIR}\n`);
  server = startServer(dbUrl);
  const health = await waitReady(server, 'pass 1');

  check('health reports a Postgres store', health.store === 'postgres', `store=${health.store}`);
  check('health reports Postgres accounts', health.accounts === 'postgres', `accounts=${health.accounts}`);

  const reg = await json('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  check('register succeeds', reg.status === 201, `status=${reg.status}`);
  const sessionCookie = reg.cookie;
  check('register returns a session cookie', Boolean(sessionCookie));

  const task = await json(
    '/api/tasks',
    { method: 'POST', body: JSON.stringify({ text: 'survive the spin-down', priority: 'high' }) },
    sessionCookie
  );
  check('task created', task.status === 201, `status=${task.status}`);

  // --- the database is asleep and has to wake up -------------------------
  console.log('\npass 1b — the database endpoint is unavailable, then wakes\n');
  if (proxy.supported) {
    proxy.goOffline();
    // The endpoint comes back while the request is still in flight, exactly
    // as a serverless database resumes a second or two after being touched.
    const waking = proxy.wake(1200);
    const duringOutage = await json('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: USER, password: PASSWORD }),
    });
    await waking;
    proxy.goOnline();
    check(
      'login succeeds while the database wakes up',
      duringOutage.status === 200,
      `status=${duringOutage.status}`
    );
  } else {
    console.log('- login-during-wakeup check skipped (endpoint requires TLS)');
  }

  // --- the recycled sockets -----------------------------------------------
  const killed = await killAllDatabaseConnections();
  check('database connections were terminated', killed > 0, `${killed} connection(s)`);

  const afterTermination = await json('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  check(
    'login succeeds after every connection is recycled',
    afterTermination.status === 200,
    `status=${afterTermination.status}`
  );

  // --- the container is destroyed -----------------------------------------
  await stop(server);
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  check('local data directory deleted (no disk)', !fs.existsSync(DATA_DIR));

  // --- pass 2: a fresh container, same database ---------------------------
  console.log('\npass 2 — new process, no disk, same database\n');
  server = startServer(dbUrl);
  const health2 = await waitReady(server, 'pass 2');
  check('health still reports Postgres', health2.store === 'postgres' && health2.accounts === 'postgres');

  // The session cookie was issued by a process that no longer exists.
  const me = await json('/api/auth/me', {}, sessionCookie);
  check(
    'session cookie from the previous process still authenticates',
    me.status === 200 && me.body.user?.username === USER,
    `status=${me.status}`
  );

  // What the browser actually does on a page load: fetch the app, then ask
  // /api/auth/me with the cookie. The web client boots on exactly this call.
  const page = await fetch(`${base}/`);
  const html = await page.text();
  check('the web client is served', page.ok && html.includes('<script'), `status=${page.status}`);
  check('the web client restores the session from /api/auth/me', html.includes('app.js'));

  const relogin = await json('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USER, password: PASSWORD }),
  });
  check('account can log in again from scratch', relogin.status === 200, `status=${relogin.status}`);

  const tasks = await json('/api/tasks', {}, relogin.cookie);
  check(
    'tasks survived the restart',
    tasks.status === 200 && tasks.body.tasks?.some((t) => t.text === 'survive the spin-down'),
    `count=${tasks.body.count}`
  );

  const sessions = await json('/api/auth/sessions', {}, relogin.cookie);
  check('sessions survived the restart', sessions.status === 200 && sessions.body.sessions?.length >= 1);

  // --- nothing important was written to disk ------------------------------
  const onDisk = ['users.json', 'sessions.json'].filter((f) => fs.existsSync(path.join(DATA_DIR, f)));
  check('no account state written to local disk', onDisk.length === 0, onDisk.join(', ') || 'clean');
} catch (err) {
  check('rehearsal ran to completion', false, err.message);
} finally {
  if (server) await stop(server);
  if (proxy) await proxy.close?.().catch?.(() => {});
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? '\nFree-host rehearsal passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
