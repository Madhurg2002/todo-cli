/**
 * Shared-core tests: locking, atomic writes, filters, Postgres adapter
 * (skipped without a database) and the account lifecycle.
 */
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';

let failures = 0;
const pending = [];
const check = (name, fn) => {
  pending.push(
    Promise.resolve()
      .then(fn)
      .then(() => console.log(`✔ ${name}`))
      .catch((err) => {
        failures++;
        console.error(`✗ ${name}: ${err.message}`);
      })
  );
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'todo-shared-test-'));
process.env.TODO_DATA_DIR = path.join(tmp, 'data');

const { readJson, writeJson, withFileLock } = await import('@todo/shared/jsonfile');
const {
  filterTasks,
  computeStats,
  sortForList,
  addTask,
  createFileStore,
  sanitizeDue,
  sanitizeTags,
  normalizeTask,
  StoreError,
} = await import('@todo/shared/store');
const { parseCommand, parseDueDate, runCommand, applyFilters } = await import('@todo/shared/commands');
const {
  createUser,
  authenticate,
  createSession,
  userForSession,
  changePassword,
  deleteAccount,
  sessionsForUser,
  revokeSessionById,
  closeAccountsPool,
  AuthError,
} = await import('@todo/shared/accounts');

// --- jsonfile --------------------------------------------------------------

check('writeJson/readJson round-trip atomically', () => {
  const file = path.join(tmp, 'round.json');
  writeJson(file, { a: 1 });
  assert.deepEqual(readJson(file, null), { a: 1 });
  assert.equal(readJson(path.join(tmp, 'missing.json'), 'fallback'), 'fallback');
});

check('withFileLock serializes concurrent writers', async () => {
  const file = path.join(tmp, 'counter.json');
  writeJson(file, { n: 0 });
  const N = 20;
  await Promise.all(
    Array.from({ length: N }, () =>
      withFileLock(file, async () => {
        const data = readJson(file, { n: 0 });
        await new Promise((r) => setTimeout(r, 2)); // widen the race window
        data.n += 1;
        writeJson(file, data);
      })
    )
  );
  assert.equal(readJson(file, { n: 0 }).n, N, 'lock failed to serialize writers');
});

check('withFileLock releases on error', async () => {
  const file = path.join(tmp, 'errlock.json');
  await withFileLock(file, async () => {
    throw new Error('boom');
  }).catch(() => {});
  // lock released → this must not time out
  await withFileLock(file, async () => {});
});

// --- schema extension: due + tags ---------------------------------------------

check('normalizeTask upgrades legacy tasks with due/tags defaults', () => {
  const t = normalizeTask({ text: 'legacy' });
  assert.equal(t.due, null);
  assert.deepEqual(t.tags, []);
  const withData = normalizeTask({ text: 'x', due: '2026-10-01T17:00:00.000Z', tags: ['#A', 'b', 'a'] });
  assert.equal(withData.due, '2026-10-01T17:00:00.000Z');
  assert.deepEqual(withData.tags, ['a', 'b']);
});

check('sanitizeDue validates and normalizes', () => {
  assert.equal(sanitizeDue(null), null);
  assert.equal(sanitizeDue(''), null);
  assert.equal(sanitizeDue('2026-10-01'), new Date('2026-10-01').toISOString());
  assert.throws(() => sanitizeDue('not-a-date'), StoreError);
  assert.throws(() => sanitizeDue(42), StoreError);
});

check('sanitizeTags lowercases, dedupes, strips # and caps at 10', () => {
  assert.deepEqual(sanitizeTags(['#Work', 'work', ' HOME ']), ['work', 'home']);
  assert.deepEqual(sanitizeTags('nope'), []);
  assert.equal(sanitizeTags(Array.from({ length: 15 }, (_, i) => `t${i}`)).length, 10);
});

check('addTask stores due + tags', () => {
  const tasks = [];
  const t = addTask(tasks, { text: 'with meta', due: '2026-10-01T17:00:00.000Z', tags: ['Dev'] });
  assert.equal(t.due, '2026-10-01T17:00:00.000Z');
  assert.deepEqual(t.tags, ['dev']);
});

// --- filters / stats ---------------------------------------------------------

const seed = [
  { id: '1', text: 'a', status: 'todo', priority: 'high', due: '2001-01-01T00:00:00Z', tags: ['work'], createdAt: '2026-01-01T00:00:00Z', completedAt: null },
  { id: '2', text: 'b', status: 'done', priority: 'low', due: '2001-01-01T00:00:00Z', tags: [], createdAt: '2026-01-02T00:00:00Z', completedAt: '2026-01-03T00:00:00Z' },
  { id: '3', text: 'c', status: 'todo', priority: 'low', due: null, tags: ['home', 'work'], createdAt: '2026-01-02T00:00:00Z', completedAt: null },
];

check('filterTasks validates status/priority', () => {
  assert.equal(filterTasks(seed, { status: 'todo' }).length, 2);
  assert.equal(filterTasks(seed, { priority: 'high' }).length, 1);
  assert.throws(() => filterTasks(seed, { status: 'finished' }), StoreError);
  assert.throws(() => filterTasks(seed, { priority: 'urgent' }), StoreError);
});

check('filterTasks filters by tag and overdue', () => {
  assert.deepEqual(filterTasks(seed, { tag: 'work' }).map((t) => t.id), ['1', '3']);
  assert.deepEqual(filterTasks(seed, { overdue: true }).map((t) => t.id), ['1'], 'done tasks are never overdue');
  assert.equal(filterTasks(seed, { tag: 'home' }).length, 1);
});

check('sortForList puts done last, then priority, then soonest due', () => {
  const sorted = sortForList(seed);
  assert.deepEqual(sorted.map((t) => t.id), ['1', '3', '2'], 'overdue high first, no-due last, done at the end');
  const samePrio = sortForList([
    { id: 'x', status: 'todo', priority: 'med', due: '2026-06-01T00:00:00Z' },
    { id: 'y', status: 'todo', priority: 'med', due: '2026-05-01T00:00:00Z' },
    { id: 'z', status: 'todo', priority: 'med', due: null },
  ]);
  assert.deepEqual(samePrio.map((t) => t.id), ['y', 'x', 'z']);
});

check('computeStats aggregates + counts overdue', () => {
  const s = computeStats(seed);
  assert.equal(s.total, 3);
  assert.equal(s.done, 1);
  assert.equal(s.todo, 2);
  assert.equal(s.byPriority.high, 1);
  assert.equal(s.percentDone, 33);
  assert.equal(s.overdue, 1);
});

// --- shared grammar: due + tags -------------------------------------------------

check('parseDueDate resolves the documented words and formats', () => {
  assert.ok(parseDueDate('today'));
  assert.ok(parseDueDate('tomorrow'));
  const fri = parseDueDate('fri');
  assert.ok(fri && new Date(fri) > new Date());
  assert.ok(parseDueDate('2026-10-01').startsWith('2026-10-01'));
  assert.ok(parseDueDate('10/01'));
  assert.equal(parseDueDate('clear'), null);
  assert.equal(parseDueDate('gibberish'), undefined);
});

check('parseCommand extracts add flags and list filters', () => {
  const add = parseCommand('add ship it --high --due fri --tag dev,ops');
  assert.equal(add.text, 'ship it');
  assert.equal(add.priority, 'high');
  assert.equal(add.due, 'fri');
  assert.equal(add.tags, 'dev,ops');
  const list = parseCommand('list +dev overdue');
  assert.deepEqual(list.filters, { status: undefined, priority: undefined, tag: 'dev', overdue: true });
  const done = parseCommand('done 3');
  assert.equal(done.index, 3);
});

check('applyFilters is the pure filter used by list', () => {
  assert.deepEqual(applyFilters(seed, { tag: 'home' }).map((t) => t.id), ['3']);
  assert.deepEqual(applyFilters(seed, { status: 'bogus' }).length, 3, 'unknown values are ignored');
});

check('runCommand due/tag/untag mutate through the store', async () => {
  const file = path.join(tmp, 'store', 'grammar.json');
  const store = createFileStore({ file, userId: 'grammar' });
  const lines = [];
  const ctx = { store, username: 'grammar', write: (cls, text) => lines.push({ cls, text }), exit() {} };
  const out = () => lines.map((l) => l.text).join('\n');

  await runCommand('add grammar task --due tomorrow --tag dev', ctx);
  assert.ok(out().includes('⏳'), 'add echoes the due date');

  await runCommand('due 1 2026-12-24', ctx);
  let { tasks } = await store.list();
  assert.ok(tasks[0].due.startsWith('2026-12-24'));

  await runCommand('tag 1 ops', ctx);
  ({ tasks } = await store.list());
  assert.deepEqual(tasks[0].tags, ['dev', 'ops']);

  await runCommand('untag 1 dev', ctx);
  ({ tasks } = await store.list());
  assert.deepEqual(tasks[0].tags, ['ops']);

  await runCommand('due 1 clear', ctx);
  ({ tasks } = await store.list());
  assert.equal(tasks[0].due, null);

  await runCommand('list +ops', ctx);
  assert.ok(out().includes('grammar task'), 'tag filter shows the task');

  await runCommand('due 1 not-a-date', ctx);
  assert.ok(lines.some((l) => l.cls === 'err'), 'bad date is a usage error');
});

check('runCommand rejects corrupt due values instead of writing them', async () => {
  const file = path.join(tmp, 'store', 'grammar-bad.json');
  const store = createFileStore({ file, userId: 'grammar-bad' });
  const lines = [];
  const ctx = { store, write: (cls, text) => lines.push({ cls, text }), exit() {} };
  await runCommand('add ok task', ctx);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  raw[0].due = { bogus: true };
  fs.writeFileSync(file, JSON.stringify(raw));
  await assert.rejects(() => runCommand('list', ctx), StoreError);
});

// --- file store --------------------------------------------------------------

check('file store create/list respects filters + locking', async () => {
  const file = path.join(tmp, 'store', 'u.json');
  const store = createFileStore({ file, userId: 'u' });
  await store.create({ text: 'one', priority: 'high' });
  await store.create({ text: 'two' });
  await store.setStatus((await store.list()).tasks[0].id, true);
  const { tasks } = await store.list({ status: 'todo' });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].text, 'two');
  await assert.rejects(() => store.list({ status: 'weird' }), StoreError);
});

check('file store patches due + tags through update()', async () => {
  const file = path.join(tmp, 'store', 'meta.json');
  const store = createFileStore({ file, userId: 'meta' });
  const created = await store.create({ text: 'meta task', due: '2026-10-01T17:00:00.000Z', tags: ['a'] });
  assert.equal(created.due, '2026-10-01T17:00:00.000Z');
  const cleared = await store.update(created.id, { due: null, tags: ['b', 'c'] });
  assert.equal(cleared.due, null);
  assert.deepEqual(cleared.tags, ['b', 'c']);
  await assert.rejects(() => store.update(created.id, { due: 'junk' }), StoreError);
  const stats = await store.stats();
  assert.equal(stats.overdue, 0);
});

check('concurrent creates all survive (lock test)', async () => {
  const file = path.join(tmp, 'store', 'race.json');
  const store = createFileStore({ file, userId: 'race' });
  await Promise.all(Array.from({ length: 12 }, (_, i) => store.create({ text: `t${i}` })));
  const { tasks } = await store.list();
  assert.equal(tasks.length, 12, `expected 12 tasks, got ${tasks.length}`);
});

check('store emits change events', async () => {
  const file = path.join(tmp, 'store', 'events.json');
  const store = createFileStore({ file, userId: 'ev' });
  const events = [];
  const { onTaskChange } = await import('@todo/shared/store');
  const off = onTaskChange((c) => events.push(c));
  await store.create({ text: 'x' });
  off();
  await store.create({ text: 'y' }); // must NOT be recorded
  const mine = events.filter((c) => c.userId === 'ev'); // other tests' stores emit too
  assert.equal(mine.length, 1);
  assert.equal(mine[0].type, 'create');
});

// --- Postgres adapter ----------------------------------------------------------

const pgUrl = process.env.TEST_DATABASE_URL;
if (!pgUrl) {
  console.log('↷ Postgres adapter tests skipped (set TEST_DATABASE_URL to run them)');
} else {
  const { createPostgresStore, migrateJsonToPostgres } = await import('@todo/shared/store');
  const store = await createPostgresStore({ connectionString: pgUrl, userId: 'pg-test' });
  await store.remove?.(); // noop safety
  const created = await store.create({ text: 'pg task', priority: 'low' });
  const { tasks } = await store.list();
  check('postgres create + list', tasks.some((t) => t.id === created.id));
  await store.setStatus(created.id, true);
  const after = await store.stats();
  check('postgres stats', after.done === 1);
  await store.remove(created.id);
  check('postgres remove', (await store.list()).tasks.length === 0);
  await store.close();
  check('migration helper exists', typeof migrateJsonToPostgres === 'function');
}

// --- accounts --------------------------------------------------------------------

async function accountsFlow() {
  const user = await createUser({ username: 'carol', password: 'secret123' });

  await (async () => {
    await assert.rejects(() => createUser({ username: 'x!', password: 'secret123' }), AuthError);
    await assert.rejects(() => createUser({ username: 'dave', password: 'short' }), AuthError);
    await assert.rejects(() => createUser({ username: 'carol', password: 'secret123' }), (err) => err.status === 409);
    console.log('✔ createUser validates');
  })().catch((err) => {
    failures++;
    console.error(`✗ createUser validates: ${err.message}`);
  });

  assert.equal((await authenticate('carol', 'secret123'))?.id, user.id);
  assert.equal(await authenticate('carol', 'wrong'), null);
  console.log('✔ authenticate verifies credentials');

  const t1 = await createSession(user.id);
  const t2 = await createSession(user.id);
  assert.equal((await userForSession(t1))?.id, user.id);
  assert.equal((await userForSession(t2))?.id, user.id);

  const slist = await sessionsForUser(user.id, t2);
  assert.equal(slist.length, 2);
  assert.ok(slist.find((s) => s.current));
  assert.ok(!slist.find((s) => s.current).id.includes(t2.slice(4, -4)), 'token must not leak into session ids');
  console.log('✔ sessions resolve and are listed with a current marker');

  const other = slist.find((s) => !s.current);
  assert.ok(await revokeSessionById(user.id, other.id));
  assert.equal(await revokeSessionById(user.id, 'zzzz-nope'), false);
  console.log('✔ revokeSessionById kills only the target');

  try {
    await assert.rejects(() => changePassword(user.id, 'wrong', 'newsecret9'), (e) => e.status === 403);
    await changePassword(user.id, 'secret123', 'newsecret9');
    assert.ok(await authenticate('carol', 'newsecret9'));
    assert.equal(await authenticate('carol', 'secret123'), null);
    // t1/t2 sessions were revoked (keepToken was null)
    assert.equal(await userForSession(t1), null);
    assert.equal(await userForSession(t2), null);
    console.log('✔ changePassword verifies current + revokes other sessions');
  } catch (err) {
    failures++;
    console.error(`✗ changePassword: ${err.message}`);
  }

  try {
    // give carol a task file so deletion has something to remove
    const taskFile = path.join(tmp, 'data', 'tasks', `${user.id}.json`);
    const carolStore = createFileStore({ file: taskFile, userId: user.id });
    await carolStore.create({ text: 'doomed task' });
    assert.ok(fs.existsSync(taskFile), 'task file should exist before deletion');

    await assert.rejects(() => deleteAccount(user.id, 'wrong'), (e) => e.status === 403);
    const res = await deleteAccount(user.id, 'newsecret9');
    assert.equal(res.user.username, 'carol');
    assert.equal(await authenticate('carol', 'newsecret9'), null);
    assert.equal(await userForSession(t1), null);
    // task cleanup matches the selected backend: PG rows or the JSON file
    if (process.env.DATABASE_URL) {
      const pg = await import('pg');
      const Pool = pg.default?.Pool ?? pg.Pool;
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM tasks WHERE user_id = $1', [user.id]);
      await pool.end();
      assert.equal(rows[0].n, 0, 'postgres task rows should be gone after deletion');
    } else {
      assert.ok(!fs.existsSync(taskFile), 'task file should be gone after deletion');
    }
    console.log('✔ deleteAccount removes user, sessions and tasks');
  } catch (err) {
    failures++;
    console.error(`✗ deleteAccount: ${err.message}`);
  }

  await Promise.resolve();
}

// --- accounts in Postgres mode (skipped without TEST_DATABASE_URL) -----------
// NOTE: the accounts backend is selected once at module load from
// DATABASE_URL, so when this file runs under scripts/run-with-pg.mjs the
// plain accountsFlow() above ALSO exercises the Postgres backend; this
// section adds Postgres-specific assertions (UNIQUE 409, cascades).

const pgAccountsUrl = process.env.TEST_DATABASE_URL;
if (!pgAccountsUrl) {
  console.log('↷ Postgres accounts tests skipped (set TEST_DATABASE_URL to run them)');
} else {
  try {
    const accounts = await import('@todo/shared/accounts');

    const pgUser = await accounts.createUser({ username: 'pgcarol', password: 'secret123' });
    check('pg accounts: createUser inserts and returns the user', pgUser.username === 'pgcarol');
    check('pg accounts: duplicate username → 409',
      await accounts.createUser({ username: 'pgcarol', password: 'secret123' }).then(
        () => false,
        (e) => e.status === 409
      ));
    check('pg accounts: authenticate verifies',
      (await accounts.authenticate('pgcarol', 'secret123'))?.id === pgUser.id &&
      (await accounts.authenticate('pgcarol', 'nope')) === null);

    const s1 = await accounts.createSession(pgUser.id);
    const s2 = await accounts.createSession(pgUser.id);
    check('pg accounts: session resolves to user', (await accounts.userForSession(s1))?.id === pgUser.id);
    const slist = await accounts.sessionsForUser(pgUser.id, s2);
    check('pg accounts: sessions listed with current marker', slist.length === 2 && slist.find((s) => s.current));
    check('pg accounts: revoke by public id',
      (await accounts.revokeSessionById(pgUser.id, slist.find((s) => !s.current).id)) === true);
    check('pg accounts: revoked session no longer resolves', (await accounts.userForSession(s1)) === null);

    await accounts.changePassword(pgUser.id, 'secret123', 'newsecret9');
    check('pg accounts: password change revokes other sessions',
      (await accounts.authenticate('pgcarol', 'newsecret9')) !== null && (await accounts.userForSession(s2)) === null);

    await accounts.deleteAccount(pgUser.id, 'newsecret9');
    check('pg accounts: deleteAccount removes user + sessions',
      (await accounts.authenticate('pgcarol', 'newsecret9')) === null &&
      (await accounts.sessionsForUser(pgUser.id)).length === 0);
  } catch (err) {
    failures++;
    console.error(`✗ pg accounts section: ${err.message}`);
  } finally {
    await closeAccountsPool();
  }
}

/**
 * Free-tier resilience: a suspended or recycled database must not turn the
 * first request after an idle period into a 500. Uses a stub pool so this
 * runs without a database.
 */
async function pgRetryFlow() {
  console.log('\npg retry:');
  const { isTransientPgError, retryingPool } = await import('@todo/shared/pg-retry');
  const check = (name, cond) => {
    if (cond) console.log(`✔ ${name}`);
    else {
      failures++;
      console.error(`✗ ${name}`);
    }
  };

  const suspended = Object.assign(new Error('terminating connection due to administrator command'), {
    code: '57P01',
  });

  check('a suspended connection is treated as transient', isTransientPgError(suspended));
  check('a socket reset is treated as transient', isTransientPgError(Object.assign(new Error('x'), { code: 'ECONNRESET' })));
  check('a wrapped socket error is treated as transient',
    isTransientPgError(Object.assign(new Error('query failed'), { cause: Object.assign(new Error('y'), { code: 'ECONNRESET' }) })));
  check('a unique-violation is NOT transient', !isTransientPgError(Object.assign(new Error('duplicate key'), { code: '23505' })));
  check('a syntax error is NOT transient', !isTransientPgError(new Error('syntax error at or near "SELCT"')));

  // A pool whose first two calls die with a transport error, then works —
  // exactly what a warm-up-after-suspension looks like.
  let calls = 0;
  const stub = {
    async query() {
      calls++;
      if (calls <= 2) throw suspended;
      return { rows: [{ ok: true }] };
    },
    async end() {},
    on() {},
  };
  const pool = retryingPool(stub, { delaysMs: [1, 1, 1] });
  const res = await pool.query('SELECT 1');
  check('a query is retried until the database answers', res.rows[0].ok === true && calls === 3);

  // A real SQL error must surface immediately, not burn four attempts.
  let hardCalls = 0;
  const broken = {
    async query() {
      hardCalls++;
      throw Object.assign(new Error('syntax error'), { code: '42601' });
    },
    async end() {},
    on() {},
  };
  await retryingPool(broken, { delaysMs: [1, 1, 1] }).query('SELCT 1').then(
    () => check('a real SQL error is not retried', false),
    () => check('a real SQL error is not retried', hardCalls === 1)
  );

  // Exhausted retries still reject — we never hang or swallow the error.
  let deadCalls = 0;
  const dead = {
    async query() {
      deadCalls++;
      throw suspended;
    },
    async end() {},
    on() {},
  };
  await retryingPool(dead, { attempts: 3, delaysMs: [1, 1, 1] }).query('SELECT 1').then(
    () => check('a permanently dead database eventually rejects', false),
    () => check('a permanently dead database eventually rejects', deadCalls === 3)
  );

  // Non-query pool members must still work (closePgPool calls end()).
  let ended = false;
  const closable = { async query() {}, async end() { ended = true; }, on() {} };
  await retryingPool(closable).end();
  check('the wrapper still forwards end() to the real pool', ended);
}

await accountsFlow();
await pgRetryFlow();
await Promise.all(pending); // let async checks finish before exiting

await closeAccountsPool();
const { closePgPool } = await import('@todo/shared/store');
await closePgPool();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(failures === 0 ? '\nAll shared-core tests passed.' : `\n${failures} test(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
