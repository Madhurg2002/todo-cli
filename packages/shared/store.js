import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { readJson, writeJson, withFileLock } from './jsonfile.js';
import {
  PRIORITIES,
  DEFAULT_PRIORITY,
  PRIORITY_RANK,
  MAX_TAGS,
} from './constants.js';

/**
 * Task store. Every surface reads/writes tasks through this module; the
 * REST API and SSH bind it to a per-user file, the CLI to TASKS_FILE.
 * Legacy plain-string entries upgrade on load.
 *
 * Two adapters, one interface:
 *   createFileStore()      — JSON file, the default (zero dependencies)
 *   createPostgresStore()  — Postgres, selected automatically when
 *                            DATABASE_URL is set (opt out with
 *                            TODO_STORE=file). `npm run migrate:pg`
 *                            copies existing JSON accounts across.
 */

export { PRIORITIES };

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

function getTasksFile() {
  return process.env.TASKS_FILE || path.join(process.cwd(), 'tasks.json');
}

export function normalizeTask(entry) {
  // Legacy files store plain strings — upgrade them in place.
  if (typeof entry === 'string') {
    entry = { text: entry };
  }
  if (entry === null || typeof entry !== 'object') {
    throw new StoreError(`invalid task entry: ${JSON.stringify(entry)}`);
  }
  const text = String(entry.text ?? '');
  const status = entry?.status === 'done' ? 'done' : 'todo';
  return {
    id: typeof entry?.id === 'string' && entry.id ? entry.id : crypto.randomUUID(),
    text,
    status,
    priority: PRIORITIES.includes(entry?.priority) ? entry.priority : 'med',
    due: sanitizeDue(entry?.due ?? null),
    tags: sanitizeTags(entry?.tags),
    createdAt: typeof entry?.createdAt === 'string' && entry.createdAt
      ? entry.createdAt
      : new Date().toISOString(),
    completedAt: status === 'done'
      ? entry?.completedAt ?? new Date().toISOString()
      : null,
  };
}

/** `due` is either null or an ISO timestamp; anything else is corruption. */
export function sanitizeDue(value) {
  if (value === null || value === undefined || value === '') return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(ms)) {
    throw new StoreError('due must be null or a valid date string');
  }
  return new Date(ms).toISOString();
}

/** Tags are lowercase words; leading '#' is stripped, capped at MAX_TAGS. */
export function sanitizeTags(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map((t) => String(t).trim().replace(/^#/, '').toLowerCase())
      .filter(Boolean)
  )].slice(0, MAX_TAGS);
}

/** A task is overdue when it is not done and its due date has passed. */
export function isOverdue(task, now = new Date()) {
  return task.status !== 'done' && Boolean(task.due) && new Date(task.due) < now;
}

export function loadTasks(file = getTasksFile()) {
  if (!fs.existsSync(file)) return [];

  let data;
  try {
    data = fs.readFileSync(file, 'utf8');
  } catch (err) {
    throw new StoreError(`Could not read ${path.basename(file)}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch (err) {
    throw new StoreError(`${path.basename(file)} is corrupted: ${err.message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new StoreError(`${path.basename(file)} does not contain a task list.`);
  }

  try {
    return parsed.map(normalizeTask);
  } catch (err) {
    if (err instanceof StoreError) {
      throw new StoreError(`${path.basename(file)} is corrupted: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Atomic save. Pass a lock file to serialize a read-modify-write cycle
 * (the store adapters do this) so concurrent sessions can't overwrite
 * each other's changes.
 */
export function saveTasks(tasks, file = getTasksFile()) {
  writeJson(file, tasks);
}

export function addTask(tasks, { text, priority = DEFAULT_PRIORITY, due = null, tags = [] }) {
  const task = {
    id: crypto.randomUUID(),
    text,
    status: 'todo',
    priority: PRIORITIES.includes(priority) ? priority : DEFAULT_PRIORITY,
    due: sanitizeDue(due),
    tags: sanitizeTags(tags),
    createdAt: new Date().toISOString(),
    completedAt: null,
  };
  tasks.push(task);
  return task;
}

export function setTaskStatus(tasks, id, done) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return null;
  task.status = done ? 'done' : 'todo';
  task.completedAt = done ? new Date().toISOString() : null;
  return task;
}

export function removeTask(tasks, id) {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;
  return tasks.splice(index, 1)[0];
}

export class StoreError extends Error {}

// --- shared filtering/sorting (one implementation, every surface) ----------

/**
 * The single task filter used by REST, the CLI and the shared grammar.
 * `status` and `priority` validate themselves (throw on bad input), so
 * callers cannot drift into accepting different values per surface.
 * `tag` matches any task tagged with it; `overdue` keeps only tasks past
 * their due date and not done.
 */
export function filterTasks(tasks, { status, priority, tag, overdue } = {}) {
  let visible = tasks;
  if (status !== undefined && status !== null && status !== '') {
    if (status !== 'done' && status !== 'todo') {
      throw new StoreError("status must be 'done' or 'todo'");
    }
    visible = visible.filter((t) => t.status === status);
  }
  if (priority !== undefined && priority !== null && priority !== '') {
    if (!PRIORITIES.includes(priority)) {
      throw new StoreError(`priority must be one of: ${PRIORITIES.join(', ')}`);
    }
    visible = visible.filter((t) => t.priority === priority);
  }
  if (tag !== undefined && tag !== null && tag !== '') {
    const wanted = String(tag).toLowerCase();
    visible = visible.filter((t) => (t.tags ?? []).includes(wanted));
  }
  if (overdue) {
    const now = new Date();
    visible = visible.filter((t) => isOverdue(t, now));
  }
  return visible;
}

/**
 * The single ordering used by `list` everywhere: done last, then
 * priority, then soonest due date first (no-due tasks last).
 */
export function sortForList(tasks) {
  const rank = PRIORITY_RANK;
  return [...tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'done' ? 1 : -1;
    if (a.priority !== b.priority) return rank[a.priority] - rank[b.priority];
    const aDue = a.status !== 'done' && a.due ? Date.parse(a.due) : null;
    const bDue = b.status !== 'done' && b.due ? Date.parse(b.due) : null;
    if (aDue !== null && bDue !== null && aDue !== bDue) return aDue - bDue;
    if (aDue !== null) return -1;
    if (bDue !== null) return 1;
    return 0;
  });
}

/** Aggregate stats — one implementation, shared by every surface. */
export function computeStats(tasks) {
  const done = tasks.filter((t) => t.status === 'done').length;
  const byPriority = { high: 0, med: 0, low: 0 };
  for (const t of tasks) byPriority[t.priority] += 1;
  const now = new Date();
  return {
    total: tasks.length,
    done,
    todo: tasks.length - done,
    byPriority,
    percentDone: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
    overdue: tasks.filter((t) => isOverdue(t, now)).length,
  };
}

// --- change feed ------------------------------------------------------------

const changeListeners = new Set();

/**
 * Subscribe to task mutations. Returns an unsubscribe function.
 * Used by the SSE endpoint so web, SSH and CLI edits appear live
 * everywhere. `change` looks like { userId, type, taskId, at }.
 */
export function onTaskChange(fn) {
  changeListeners.add(fn);
  return () => changeListeners.delete(fn);
}

function emitChange(change) {
  for (const fn of changeListeners) {
    try {
      fn(change);
    } catch {
      // a broken subscriber must not break the mutation
    }
  }
}

// --- file adapter -----------------------------------------------------------

function applyPatch(task, patch) {
  if (typeof patch.text === 'string' && patch.text.trim()) task.text = patch.text.trim();
  if (PRIORITIES.includes(patch.priority)) task.priority = patch.priority;
  if (patch.due !== undefined) task.due = sanitizeDue(patch.due);
  if (patch.tags !== undefined) task.tags = sanitizeTags(patch.tags);
  return task;
}

/**
 * Adapter exposing the async store interface the shared command grammar
 * expects. Backed by a JSON file (the CLI default, or one file per user).
 * Every mutation runs under a file lock, so concurrent sessions
 * (server + CLI against the same TASKS_FILE) queue instead of clobber.
 * @param {{ file?: string, userId?: string }} opts
 */
export function createFileStore({ file = getTasksFile(), userId = null } = {}) {
  const load = () => loadTasks(file);
  const save = (tasks) => saveTasks(tasks, file);
  /** Serialize a read-modify-write cycle against other processes. */
  const mutate = (fn) => withFileLock(file, async () => {
    const tasks = load();
    const result = await fn(tasks);
    save(tasks);
    return result;
  });
  const note = (type, taskId) => emitChange({ userId, type, taskId, at: new Date().toISOString() });

  return {
    kind: 'file',
    file,

    async list(filters = {}) {
      const tasks = load();
      return { tasks: sortForList(filterTasks(tasks, filters)) };
    },

    async create({ text, priority = DEFAULT_PRIORITY, due = null, tags = [] }) {
      const task = await mutate((tasks) => {
        const created = addTask(tasks, { text: text.trim(), priority, due, tags });
        return created;
      });
      note('create', task.id);
      return task;
    },

    async update(id, patch = {}) {
      let updated = null;
      try {
        updated = await mutate((tasks) => {
          const task = tasks.find((t) => t.id === id);
          if (!task) return null;
          applyPatch(task, patch);
          return task;
        });
      } catch (err) {
        if (err instanceof StoreError) throw err;
        throw err;
      }
      if (updated) note('update', id);
      return updated;
    },

    async setStatus(id, done) {
      const task = await mutate((tasks) => setTaskStatus(tasks, id, done));
      if (task) note(done ? 'done' : 'undo', id);
      return task;
    },

    async remove(id) {
      const task = await mutate((tasks) => removeTask(tasks, id));
      if (task) note('remove', id);
      return task;
    },

    async stats() {
      return computeStats(load());
    },
  };
}

// --- Postgres adapter (selected when DATABASE_URL is set) --------------------

let pgModule = null;

/**
 * Load `pg` lazily — only required when a DATABASE_URL is configured, so
 * JSON-mode users never need the dependency installed.
 */
async function getPg() {
  if (!pgModule) {
    const mod = await import('pg').catch(() => null);
    if (!mod) {
      throw new StoreError(
        "DATABASE_URL is set but the 'pg' package is not installed — run: npm install pg"
      );
    }
    pgModule = mod.default?.Pool ? mod.default : mod;
  }
  return pgModule;
}

let sharedPool = null;

/**
 * One pool per process for every Postgres consumer (task stores, accounts,
 * migrations). Avoids the pre-refactor bug of a fresh pool per request.
 */
export async function getSharedPgPool() {
  if (!sharedPool) {
    const pg = await getPg();
    sharedPool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
    sharedPool.on('error', () => {}); // idle client errors must not crash the server
  }
  return sharedPool;
}

/** Close the shared pool (used by tests and graceful shutdown). */
export async function closePgPool() {
  if (sharedPool) {
    const pool = sharedPool;
    sharedPool = null;
    await pool.end().catch(() => {});
  }
}

let schemaReady = null;
async function ensureSchema(db) {
  if (!schemaReady) {
    schemaReady = db.query(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'todo',
        priority TEXT NOT NULL DEFAULT 'med',
        due TIMESTAMPTZ,
        tags TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        completed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS tasks_user_idx ON tasks (user_id);
    `);
  }
  await schemaReady;
}

function rowToTask(row) {
  return {
    id: row.id,
    text: row.text,
    status: row.status,
    priority: row.priority,
    due: row.due?.toISOString?.() ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
    completedAt: row.completed_at?.toISOString?.() ?? row.completed_at,
  };
}

/**
 * Postgres-backed store. Same async interface as createFileStore; no
 * locking needed (the database serializes writes) and changes are
 * announced through the same onTaskChange feed.
 * @param {{ connectionString?: string, userId?: string }} opts
 */
export async function createPostgresStore({ connectionString, userId = null } = {}) {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new StoreError('createPostgresStore needs a DATABASE_URL');
  const pg = await getPg();
  const db = connectionString
    ? new pg.Pool({ connectionString: url, max: 5 })
    : await getSharedPgPool();
  await ensureSchema(db);

  const note = (type, taskId) => emitChange({ userId, type, taskId, at: new Date().toISOString() });

  async function listRows(filters = {}) {
    const values = [userId];
    const where = ['user_id = $1'];
    if (filters.status) {
      if (filters.status !== 'done' && filters.status !== 'todo') {
        throw new StoreError("status must be 'done' or 'todo'");
      }
      values.push(filters.status);
      where.push(`status = $${values.length}`);
    }
    if (filters.priority) {
      if (!PRIORITIES.includes(filters.priority)) {
        throw new StoreError(`priority must be one of: ${PRIORITIES.join(', ')}`);
      }
      values.push(filters.priority);
      where.push(`priority = $${values.length}`);
    }
    if (filters.tag) {
      values.push(String(filters.tag).toLowerCase());
      where.push(`$${values.length} = ANY(tags)`);
    }
    if (filters.overdue) {
      where.push(`due IS NOT NULL AND due < now() AND status <> 'done'`);
    }
    const { rows } = await db.query(
      `SELECT * FROM tasks WHERE ${where.join(' AND ')}`,
      values
    );
    return rows;
  }

  return {
    kind: 'postgres',

    async list(filters = {}) {
      const tasks = (await listRows(filters)).map(rowToTask);
      return { tasks: sortForList(tasks) };
    },

    async create({ text, priority = 'med', due = null, tags = [] }) {
      const id = crypto.randomUUID();
      const { rows } = await db.query(
        `INSERT INTO tasks (id, user_id, text, priority, due, tags) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          id,
          userId,
          String(text).trim(),
          PRIORITIES.includes(priority) ? priority : DEFAULT_PRIORITY,
          due ? new Date(due) : null,
          sanitizeTags(tags),
        ]
      );
      note('create', id);
      return rowToTask(rows[0]);
    },

    async update(id, patch = {}) {
      if (typeof patch.text === 'string' && !patch.text.trim()) return null;
      const sets = [];
      const values = [id, userId];
      if (patch.text !== undefined) {
        values.push(patch.text?.trim() ?? null);
        sets.push(`text = $${values.length}`);
      }
      if (patch.priority !== undefined) {
        values.push(PRIORITIES.includes(patch.priority) ? patch.priority : DEFAULT_PRIORITY);
        sets.push(`priority = $${values.length}`);
      }
      if (patch.due !== undefined) {
        values.push(patch.due ? new Date(sanitizeDue(patch.due)) : null);
        sets.push(`due = $${values.length}`);
      }
      if (patch.tags !== undefined) {
        values.push(sanitizeTags(patch.tags));
        sets.push(`tags = $${values.length}`);
      }
      if (sets.length === 0) return null;
      const { rows } = await db.query(
        `UPDATE tasks SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING *`,
        values
      );
      if (!rows.length) return null;
      note('update', id);
      return rowToTask(rows[0]);
    },

    async setStatus(id, done) {
      const { rows } = await db.query(
        `UPDATE tasks SET status = $3, completed_at = $4
         WHERE id = $1 AND user_id = $2 RETURNING *`,
        [id, userId, done ? 'done' : 'todo', done ? new Date() : null]
      );
      if (!rows.length) return null;
      note(done ? 'done' : 'undo', id);
      return rowToTask(rows[0]);
    },

    async remove(id) {
      const { rows } = await db.query(
        `DELETE FROM tasks WHERE id = $1 AND user_id = $2 RETURNING *`,
        [id, userId]
      );
      if (!rows.length) return null;
      note('remove', id);
      return rowToTask(rows[0]);
    },

    async stats() {
      return computeStats((await listRows()).map(rowToTask));
    },

    /** Used by migrate:pg and the shutdown path. */
    async close() {
      await db.end();
    },
  };
}

/**
 * One-shot migration: copy every JSON account in TODO_DATA_DIR into
 * Postgres. Idempotent per task id (INSERT ... ON CONFLICT DO UPDATE).
 * Run with: npm run migrate:pg
 */
export async function migrateJsonToPostgres({ connectionString } = {}) {
  const url = connectionString ?? process.env.DATABASE_URL;
  if (!url) throw new StoreError('migrateJsonToPostgres needs a DATABASE_URL');
  const { tasksFileFor, DATA_DIR } = await import('./accounts.js');

  const dataDir = process.env.TODO_DATA_DIR || DATA_DIR;
  const tasksDir = path.join(dataDir, 'tasks');
  if (!fs.existsSync(tasksDir)) {
    return { users: 0, tasks: 0, sessions: 0 };
  }

  const pg = await getPg();
  const db = new pg.Pool({ connectionString: url, max: 2 });
  try {
    await ensureSchema(db);
    // The accounts tables share this database; make sure they exist so
    // users/sessions can be migrated in the same run.
    const { ensureAccountsSchema } = await import('./accounts.js');
    await ensureAccountsSchema(db);

    let taskCount = 0;
    let userCount = 0;
    let sessionCount = 0;
    const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith('.json'));

    // users first (tasks.sessions reference them)
    if (fs.existsSync(usersJsonPath())) {
      for (const u of readJson(usersJsonPath(), [])) {
        await db.query(
          `INSERT INTO users (id, username, password_hash, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET
             username = EXCLUDED.username, password_hash = EXCLUDED.password_hash`,
          [u.id, u.username, u.passwordHash, u.createdAt]
        );
        userCount += 1;
      }
    }
    if (fs.existsSync(sessionsJsonPath())) {
      for (const s of readJson(sessionsJsonPath(), [])) {
        await db.query(
          `INSERT INTO sessions (token, user_id, created_at, expires_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (token) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
          [s.token, s.userId, s.createdAt, new Date(s.expiresAt)]
        );
        sessionCount += 1;
      }
    }

    for (const file of files) {
      const userId = file.replace(/\.json$/, '');
      const tasks = loadTasks(path.join(tasksDir, file));
      for (const t of tasks) {
        await db.query(
          `INSERT INTO tasks (id, user_id, text, status, priority, due, tags, created_at, completed_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT (id) DO UPDATE SET
             text = EXCLUDED.text, status = EXCLUDED.status,
             priority = EXCLUDED.priority, due = EXCLUDED.due,
             tags = EXCLUDED.tags, completed_at = EXCLUDED.completed_at`,
          [t.id, userId, t.text, t.status, t.priority, t.due ? new Date(t.due) : null, t.tags ?? [], t.createdAt, t.completedAt]
        );
        taskCount += 1;
      }
    }
    return { users: userCount, tasks: taskCount, sessions: sessionCount };
  } finally {
    await db.end();
  }
}

function usersJsonPath() {
  const dataDir = process.env.TODO_DATA_DIR || path.join(process.cwd(), '.data');
  return path.join(dataDir, 'users.json');
}

function sessionsJsonPath() {
  const dataDir = process.env.TODO_DATA_DIR || path.join(process.cwd(), '.data');
  return path.join(dataDir, 'sessions.json');
}

/**
 * Store selection at boot: DATABASE_URL + not explicitly file → Postgres.
 * Every surface goes through this so the backing store is one decision.
 * Async because the Postgres adapter connects (and creates its schema).
 */
export async function createStoreFor(userId, { file } = {}) {
  if (process.env.DATABASE_URL && process.env.TODO_STORE !== 'file') {
    return createPostgresStore({ userId });
  }
  return createFileStore({ file: file ?? tasksFileFor(userId), userId });
}

function tasksFileFor(userId) {
  const dataDir = process.env.TODO_DATA_DIR || path.join(process.cwd(), '.data');
  return path.join(dataDir, 'tasks', `${userId}.json`);
}

/**
 * Remove a user's task data (used by account deletion): the JSON file in
 * file mode, the Postgres rows when DATABASE_URL selects the PG store.
 */
export async function removeTasksForUser(userId) {
  if (process.env.DATABASE_URL && process.env.TODO_STORE !== 'file') {
    try {
      const pool = await getSharedPgPool();
      await pool.query('DELETE FROM tasks WHERE user_id = $1', [userId]);
    } catch {
      // best effort — account deletion must not fail on a missing table
    }
    return;
  }
  try {
    const file = tasksFileFor(userId);
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
  } catch {
    // best effort — account deletion must not fail on a missing file
  }
}
